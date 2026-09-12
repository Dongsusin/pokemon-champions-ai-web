// Exercise the production ranked UI with isolated auth/API and wallet callback fixtures.
// No real account, ranking, or VP balance is changed. Async failure and stale-response
// cases verify the UI contract; wallet persistence is covered by validateRankedVpWallet.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { normalizePokemon } from '../src/data/trainingData.js';
import { createSavedTeams } from '../src/data/teamData.js';
import { createRankedProfile } from '../src/data/rankedRules.js';
import { resolveChromiumExecutable } from '../promo/scripts/browserRuntime.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'scripts/.cache/ranked-vp-ui-probe');
await fs.mkdir(output, {
  recursive: true
});
const require = createRequire(new URL('../promo/package.json', import.meta.url));
const {
  chromium
} = require('playwright');
const boxPokemon = [25, 6, 9, 3, 143, 94].map(speciesId => normalizePokemon({
  speciesId,
  captureId: `vp-${speciesId}`
}));
const teams = createSavedTeams(boxPokemon.map(pokemon => pokemon.captureId), boxPokemon.map(pokemon => pokemon.captureId));
const entry = `
import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import RankedBattleScreen from '/src/RankedBattleScreen.jsx';
import '/src/styles.css';
import '/src/screenRedesign.css';
import '/src/battleHub.css';
window.__vpCalls = [];
window.__vpApplied = 0;
window.__vpBalance = 5000;
window.__vpFail = false;
window.__vpPause = false;
window.__vpRelease = null;
function Harness() {
  const [version, setVersion] = useState(0);
  window.__vpRerender = () => setVersion(value => value + 1);
  return React.createElement('div', {
    className: 'app-shell ranked-view'
  }, React.createElement('header', {
    className: 'topbar'
  }, React.createElement('div', {
    className: 'brand'
  }, 'CHAMPIONS ARENA'), React.createElement('span', null, 'VP ', window.__vpBalance)), React.createElement(RankedBattleScreen, {
    user: {
      uid: 'vp-ui',
      displayName: 'VP 검증'
    },
    teams: window.__fixture.teams,
    boxPokemon: window.__fixture.boxPokemon,
    activeTeamId: 'team-1',
    soundEnabled: false,
    onBack: () => {},
    onVpRewards: window.__testNoCallback ? undefined : async reward => {
      window.__vpCalls.push({
        ...reward,
        version
      });
      if (window.__vpPause) await new Promise(resolve => window.__vpRelease = resolve);
      if (window.__vpFail) throw Error('QA wallet failure');
      const granted = Math.max(0, reward.total - window.__vpApplied);
      window.__vpApplied = Math.max(reward.total, window.__vpApplied);
      window.__vpBalance += granted;
      setVersion(value => value + 1);
      return {
        granted,
        appliedTotal: window.__vpApplied
      };
    }
  }));
}
createRoot(document.getElementById('root')).render(React.createElement(StrictMode, null, React.createElement(Harness)));
`;
process.env.VITE_RANKED_ENABLED = 'true';
process.env.VITE_RANKED_LOCAL_TEST = 'false';
process.env.VITE_RANKED_API_URL = '/api/ranked';
const server = await createServer({
  root,
  mode: 'vp-ui-validation',
  logLevel: 'error',
  plugins: [{
    name: 'ranked-vp-fixture',
    enforce: 'pre',
    resolveId(source) {
      if (source === '/vp-entry.js') return source;
      if (source.endsWith('/auth/firebaseClient') || source.endsWith('/auth/firebaseClient.js')) return '\0vp-auth';
    },
    load(id) {
      if (id === '/vp-entry.js') return entry;
      if (id === '\0vp-auth') return `export const firebaseAuth={currentUser:{uid:'vp-ui',getIdToken:async()=>'fixture'}};export const firebaseDb=null;export const isFirebaseConfigured=false;export const missingFirebaseEnvironmentVariables=[];`;
    }
  }],
  server: {
    host: '127.0.0.1',
    port: 5250,
    strictPort: true,
    hmr: false
  }
});
await server.listen();
let browser;
const results = [];
const errors = [];
let currentPage;
function check(name) {
  results.push(name);
  console.log(`PASS ${name}`);
}
try {
  browser = await chromium.launch({
    executablePath: await resolveChromiumExecutable(chromium),
    headless: true
  });
  const html = await server.transformIndexHtml('/vp.html', '<!doctype html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body><div id="root"></div><script type="module" src="/vp-entry.js"></script></body></html>');
  for (const device of [{
    id: 'desktop',
    viewport: {
      width: 1440,
      height: 900
    }
  }, {
    id: 'mobile',
    viewport: {
      width: 844,
      height: 390
    },
    hasTouch: true,
    isMobile: true
  }]) {
    const context = await browser.newContext(device);
    await context.addInitScript(value => {
      window.__fixture = value;
    }, {
      boxPokemon,
      teams
    });
    await context.route('**/vp.html', route => route.fulfill({
      contentType: 'text/html',
      body: html
    }));
    const profile = {
      single: createRankedProfile('single'),
      double: createRankedProfile('double')
    };
    let state = {
      profile,
      queue: null,
      match: null,
      vpRewards: {
        uid: 'vp-ui',
        total: 1000
      }
    };
    let deferred = null;
    const requests = [];
    await context.route('**/api/ranked*', async route => {
      requests.push(route.request().url());
      if (deferred) {
        const target = deferred;
        deferred = null;
        target.started();
        await target.wait;
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            ...target.state,
            serverTime: Date.now()
          })
        });
        return;
      }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ...state,
          serverTime: Date.now()
        })
      });
    });
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5250/vp.html');
    await page.waitForFunction(() => window.__vpApplied === 1000);
    assert.equal(await page.evaluate(() => window.__vpBalance), 6000);
    check(`${device.id}: initial cumulative VP catch-up applies a large increment`);
    const refresh = async () => {
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await page.waitForTimeout(100);
    };
    const fit = async label => {
      const geometry = await page.evaluate(() => {
        const targets = [...document.querySelectorAll('.ranked-result,.ranked-result-vp,.ranked-primary,.ranked-vp-rules,.ranked-vp-error')].filter(el => el.getClientRects().length);
        return {
          width: innerWidth,
          height: innerHeight,
          scrollHeight: document.documentElement.scrollHeight,
          scrollWidth: document.documentElement.scrollWidth,
          targets: targets.map(el => ({
            name: el.className,
            ...Object.fromEntries(['left', 'right', 'top', 'bottom'].map(key => [key, el.getBoundingClientRect()[key]]))
          }))
        };
      });
      assert(geometry.scrollHeight <= geometry.height + 1 && geometry.scrollWidth <= geometry.width + 1, JSON.stringify(geometry));
      for (const bounds of geometry.targets) assert(bounds.left >= -1 && bounds.top >= -1 && bounds.right <= geometry.width + 1 && bounds.bottom <= geometry.height + 1, JSON.stringify(geometry));
      check(`${device.id}: ${label} fits viewport without scrolling`);
    };
    await fit('lobby reward rules');
    const start = {
      id: 'vp-match',
      phase: 'select',
      format: 'single',
      revision: 2,
      teamPreview: {
        you: boxPokemon,
        opponent: boxPokemon
      },
      opponent: {
        name: '상대'
      },
      deadlineAt: Date.now() + 60000
    };
    state = {
      ...state,
      match: start
    };
    await refresh();
    await page.locator('.ranked-selection').waitFor();
    await page.evaluate(() => window.__vpFail = true);
    state = {
      ...state,
      vpRewards: {
        uid: 'vp-ui',
        total: 1300
      },
      match: {
        ...start,
        phase: 'finished',
        revision: 3,
        result: {
          outcome: 'win',
          reason: 'battle',
          ratingBefore: 1000,
          ratingAfter: 1016,
          ratingDelta: 16,
          rewardVp: 300
        }
      }
    };
    await refresh();
    await page.locator('.ranked-result').waitFor();
    await page.getByRole('button', {
      name: '보상 다시 받기'
    }).waitFor();
    assert.match(await page.locator('.ranked-result-vp').innerText(), /\+300 VP/);
    assert.match(await page.locator('.ranked-result-vp').innerText(), /지급 확인 중/);
    assert.equal(await page.evaluate(() => window.__vpBalance), 6000);
    check(`${device.id}: wallet failure keeps match result and shows independent reward retry`);
    await fit('reward retry result');
    const failedCalls = await page.evaluate(() => window.__vpCalls.length);
    await page.evaluate(() => window.__vpRerender());
    await refresh();
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__vpCalls.length), failedCalls);
    assert.equal(await page.locator('.ranked-result').count(), 1);
    check(`${device.id}: repeated poll and callback identity change do not retry or reset match`);
    await page.evaluate(() => window.__vpFail = false);
    await page.getByRole('button', {
      name: '보상 다시 받기'
    }).click();
    await page.waitForFunction(() => document.querySelector('.ranked-result-vp')?.textContent.includes('지급 완료'));
    assert.equal(await page.evaluate(() => window.__vpBalance), 6300);
    await page.locator('.ranked-vp-error').waitFor({
      state: 'detached'
    });
    check(`${device.id}: explicit reward retry credits once and confirms payment`);
    await page.screenshot({
      path: path.join(output, `${device.id}-paid-result.png`)
    });
    await page.evaluate(() => window.__vpPause = true);
    state = {
      ...state,
      vpRewards: {
        uid: 'vp-ui',
        total: 1600
      }
    };
    await refresh();
    await page.waitForFunction(() => Boolean(window.__vpRelease));
    state = {
      ...state,
      vpRewards: {
        uid: 'vp-ui',
        total: 1900
      }
    };
    await refresh();
    state = {
      ...state,
      vpRewards: {
        uid: 'vp-ui',
        total: 1700
      }
    };
    await refresh();
    await page.evaluate(() => {
      window.__vpPause = false;
      window.__vpRelease();
      window.__vpRelease = null;
    });
    await page.waitForFunction(() => window.__vpApplied === 1900);
    assert.equal(await page.evaluate(() => window.__vpBalance), 6900);
    assert.deepEqual((await page.evaluate(() => window.__vpCalls.map(entry => entry.total))).slice(-2), [1600, 1900]);
    check(`${device.id}: overlapping writes drain highest cumulative total and ignore lower snapshots`);
    let release, startWait;
    const wait = new Promise(resolve => release = resolve),
      started = new Promise(resolve => startWait = resolve);
    deferred = {
      state: {
        ...state,
        vpRewards: {
          uid: 'vp-ui',
          total: 2300
        }
      },
      wait,
      started: startWait
    };
    await refresh();
    await started;
    await page.getByRole('button', {
      name: '레이팅 로비로',
      exact: true
    }).click();
    release();
    await page.waitForFunction(() => window.__vpApplied === 2300);
    await page.locator('.ranked-lobby-grid').waitFor();
    assert.equal(await page.locator('.ranked-result').count(), 0);
    assert.equal(await page.evaluate(() => window.__vpBalance), 7300);
    check(`${device.id}: a stale dismissed-match response still credits newer VP without reopening result`);
    state = {
      ...state,
      match: null,
      vpRewards: {
        uid: 'another-account',
        total: 99999
      }
    };
    await refresh();
    assert.equal(await page.evaluate(() => window.__vpApplied), 2300);
    check(`${device.id}: another account reward is rejected`);
    state = {
      profile,
      queue: null,
      vpRewards: {
        uid: 'vp-ui',
        total: 2300
      },
      match: {
        ...start,
        id: 'vp-zero',
        revision: 2
      }
    };
    await refresh();
    await page.locator('.ranked-selection').waitFor();
    state = {
      ...state,
      match: {
        ...state.match,
        phase: 'finished',
        revision: 3,
        result: {
          outcome: 'loss',
          reason: 'forfeit',
          rewardVp: 0
        }
      }
    };
    await refresh();
    await page.locator('.ranked-result').waitFor();
    assert.match(await page.locator('.ranked-result-vp').innerText(), /\+0 VP/);
    assert.match(await page.locator('.ranked-result-vp').innerText(), /지급 완료/);
    check(`${device.id}: zero VP result is explicit and does not add money`);
    await fit('zero reward result');
    await page.evaluate(() => {
      window.__testNoCallback = true;
      window.__vpRerender();
    });
    await page.waitForFunction(() => document.querySelector('.ranked-result-vp')?.textContent.includes('테스트 보상'));
    check(`${device.id}: development callback absence labels test rewards`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({
    count: results.length,
    results,
    errors
  }, null, 2));
  console.log(`Ranked VP UI checks: ${results.length}/${results.length} passed`);
} catch (error) {
  await currentPage?.screenshot({
    path: path.join(output, 'failure.png')
  }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await server.close();
}
