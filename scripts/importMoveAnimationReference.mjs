import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const rootDirectory = path.resolve(scriptDirectory, '..')
const defaultSourcePath = path.join(homedir(), 'Downloads', 'pokemon_gen5_move_animation_all_in_one_ko.txt')
const manifestHeader = 'record_no,scope,move_id,move_key,korean_name,english_name,generation,type_ko,type_en,record_variant,recommended_coverage,fidelity,availability,manual_action,notes'
const manualQueueHeader = 'priority,move_id,korean_name,english_name,variant,coverage_state,reference_source,implementation_requirement,acceptance_test'
const expectedRecordCount = 971
const expectedManualQueueCount = 62

function parseArguments(argumentsList) {
  const sourceFlagIndex = argumentsList.indexOf('--source')
  const explicitSource = sourceFlagIndex >= 0 ? argumentsList[sourceFlagIndex + 1] : null
  return {
    sourcePath: explicitSource || process.env.MOVE_ANIMATION_REFERENCE_SOURCE || defaultSourcePath,
  }
}

function parseCsv(csvText) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index]
    const nextCharacter = csvText[index + 1]

    if (character === '"') {
      if (quoted && nextCharacter === '"') {
        value += '"'
        index += 1
      } else {
        quoted = !quoted
      }
      continue
    }

    if (character === ',' && !quoted) {
      row.push(value)
      value = ''
      continue
    }

    if (character === '\n' && !quoted) {
      row.push(value.replace(/\r$/, ''))
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      value = ''
      continue
    }

    value += character
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value.replace(/\r$/, ''))
    if (row.some((cell) => cell.length > 0)) rows.push(row)
  }

  if (!rows.length) return []
  const headers = rows[0]
  return rows.slice(1).map((cells, rowIndex) => {
    if (cells.length !== headers.length) {
      throw new Error(`CSV row ${rowIndex + 2} has ${cells.length} columns; expected ${headers.length}.`)
    }
    return Object.fromEntries(headers.map((header, columnIndex) => [header, cells[columnIndex]]))
  })
}

function extractCsvSection(sourceText, headerLine) {
  const lines = sourceText.replace(/\r\n/g, '\n').split('\n')
  const startIndex = lines.indexOf(headerLine)
  if (startIndex < 0) throw new Error(`Could not find CSV header: ${headerLine}`)

  let endIndex = startIndex + 1
  while (endIndex < lines.length && !/^={20,}$/.test(lines[endIndex])) endIndex += 1
  const sectionLines = lines.slice(startIndex, endIndex)
  while (sectionLines.at(-1)?.trim() === '') sectionLines.pop()
  return parseCsv(sectionLines.join('\n'))
}

function normalizeIdentifier(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function countBy(records, fieldName) {
  return Object.fromEntries(
    [...records.reduce((counts, record) => {
      const value = record[fieldName]
      counts.set(value, (counts.get(value) ?? 0) + 1)
      return counts
    }, new Map())].sort(([left], [right]) => left.localeCompare(right)),
  )
}

function firstPriority(queueItems) {
  return [...new Set(queueItems.map((item) => item.priority))].sort()[0] ?? null
}

function fidelityGrade(value) {
  return value.match(/^([ABC])(?:\b|:)/)?.[1] ?? null
}

function csvEscape(value) {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function buildAliases(record) {
  return [...new Set([
    normalizeIdentifier(record.moveKey),
    normalizeIdentifier(record.englishName),
    normalizeIdentifier(record.koreanName),
  ].filter(Boolean))]
}

function activeMoveAliases(move) {
  const aliases = [
    normalizeIdentifier(move.id),
    normalizeIdentifier(move.englishName),
    normalizeIdentifier(move.name),
  ].filter(Boolean)
  if (aliases[0]?.startsWith('hiddenpower')) aliases.push('hiddenpower')
  return [...new Set(aliases)]
}

function chooseActiveReference(move, recordsByAlias) {
  const candidates = activeMoveAliases(move)
    .flatMap((alias) => recordsByAlias.get(alias) ?? [])
    .filter((record, index, records) => records.findIndex((candidate) => candidate.recordNo === record.recordNo) === index)

  return candidates.find((record) => ['STANDARD_MOVE', 'STANDARD_WITH_HEAL_BRANCH', 'TERA_TYPE_VARIANTS', 'FORM_TYPE_VARIANTS', 'LGPE_PARTNER_MOVE', 'STARMOBILE_TORQUE', 'PLZA_NEW_MOVE'].includes(record.variant))
    ?? candidates[0]
    ?? null
}

function readProjectJson(relativePath) {
  return JSON.parse(readFileSync(path.join(rootDirectory, relativePath), 'utf8'))
}

function main() {
  const { sourcePath } = parseArguments(process.argv.slice(2))
  if (!sourcePath || !existsSync(sourcePath)) {
    throw new Error(`Reference source not found. Pass --source <path> or set MOVE_ANIMATION_REFERENCE_SOURCE. Checked: ${sourcePath}`)
  }

  const sourceBuffer = readFileSync(sourcePath)
  const sourceText = sourceBuffer.toString('utf8').replace(/^\uFEFF/, '')
  const sourceSha256 = createHash('sha256').update(sourceBuffer).digest('hex')
  const sourceDate = sourceText.match(/^생성일:\s*(\d{4}-\d{2}-\d{2})/m)?.[1] ?? null
  const manifestRows = extractCsvSection(sourceText, manifestHeader)
  const manualQueueRows = extractCsvSection(sourceText, manualQueueHeader)

  if (manifestRows.length !== expectedRecordCount) {
    throw new Error(`Expected ${expectedRecordCount} manifest records, found ${manifestRows.length}.`)
  }
  if (manualQueueRows.length !== expectedManualQueueCount) {
    throw new Error(`Expected ${expectedManualQueueCount} manual queue records, found ${manualQueueRows.length}.`)
  }

  const recordNumbers = manifestRows.map((row) => Number(row.record_no))
  if (recordNumbers.some((recordNumber, index) => recordNumber !== index + 1)) {
    throw new Error('Manifest record_no values must be a continuous 1-based sequence.')
  }

  const manualQueueByMoveId = new Map()
  manualQueueRows.forEach((row) => {
    const key = String(row.move_id)
    const queue = manualQueueByMoveId.get(key) ?? []
    queue.push(row)
    manualQueueByMoveId.set(key, queue)
  })

  const records = manifestRows.map((row) => {
    const queueItems = manualQueueByMoveId.get(String(row.move_id)) ?? []
    return {
      recordNo: Number(row.record_no),
      scope: row.scope,
      moveId: /^\d+$/.test(row.move_id) ? Number(row.move_id) : row.move_id,
      moveKey: row.move_key,
      aliases: buildAliases({
        moveKey: row.move_key,
        koreanName: row.korean_name,
        englishName: row.english_name,
      }),
      koreanName: row.korean_name || null,
      englishName: row.english_name,
      generation: Number(row.generation) || null,
      type: row.type_ko,
      typeId: normalizeIdentifier(row.type_en),
      variant: row.record_variant,
      availability: row.availability,
      fidelity: fidelityGrade(row.fidelity),
      manualPriority: firstPriority(queueItems),
      manualVariants: [...new Set(queueItems.map((item) => item.variant))],
    }
  })

  const recordsByAlias = new Map()
  records.forEach((record) => {
    record.aliases.forEach((alias) => {
      const candidates = recordsByAlias.get(alias) ?? []
      candidates.push(record)
      recordsByAlias.set(alias, candidates)
    })
  })

  const battleMoveData = readProjectJson('src/data/generatedBattleMoves.json')
  const animationManifest = readProjectJson('src/data/generatedMoveAnimationManifest.json')
  const activeMoveIndex = {}
  const unmatchedActiveMoveIds = []
  const activeAvailabilityCounts = new Map()
  let dedicatedEbdxCount = 0
  let fallbackEbdxCount = 0

  battleMoveData.moves.forEach((move) => {
    const reference = chooseActiveReference(move, recordsByAlias)
    if (!reference) {
      unmatchedActiveMoveIds.push(move.id)
      return
    }
    activeMoveIndex[move.id] = reference.recordNo
    activeAvailabilityCounts.set(reference.availability, (activeAvailabilityCounts.get(reference.availability) ?? 0) + 1)
    if (animationManifest.moves[move.id]?.specific) dedicatedEbdxCount += 1
    else fallbackEbdxCount += 1
  })

  const generatedReference = {
    schemaVersion: 1,
    generatedAt: sourceDate,
    source: {
      fileName: path.basename(sourcePath),
      sha256: sourceSha256,
      includesOriginalGameAssets: false,
      officialBaseline: 'Pokémon Black 2 and White 2',
      laterGenerationPolicy: 'Fan-made generation-5-style reconstruction',
    },
    logicalCanvas: {
      width: 256,
      height: 192,
      pixelSnap: true,
      textureFilter: 'nearest',
      tickRate: 60,
    },
    counts: {
      records: records.length,
      manualQueue: manualQueueRows.length,
      scopes: countBy(records, 'scope'),
      variants: countBy(records, 'variant'),
      availability: countBy(records, 'availability'),
      manualPriorities: countBy(manualQueueRows, 'priority'),
      activeMoves: battleMoveData.moves.length,
      activeReferenceMatches: Object.keys(activeMoveIndex).length,
      dedicatedEbdx: dedicatedEbdxCount,
      fallbackEbdx: fallbackEbdxCount,
      activeAvailability: Object.fromEntries([...activeAvailabilityCounts].sort(([left], [right]) => left.localeCompare(right))),
    },
    unmatchedActiveMoveIds,
    activeMoveIndex,
    records,
    manualQueue: manualQueueRows.map((row) => ({
      priority: row.priority,
      moveId: /^\d+$/.test(row.move_id) ? Number(row.move_id) : row.move_id,
      koreanName: row.korean_name || null,
      englishName: row.english_name,
      variant: row.variant,
      coverageState: row.coverage_state,
      referenceSource: row.reference_source,
      implementationRequirement: row.implementation_requirement,
      acceptanceTest: row.acceptance_test,
    })),
  }

  const runtimeOutputPath = path.join(rootDirectory, 'src/data/generatedMoveAnimationReference.json')
  const qaOutputPath = path.join(rootDirectory, 'docs/move-animation-qa-checklist.csv')
  mkdirSync(path.dirname(qaOutputPath), { recursive: true })
  writeFileSync(runtimeOutputPath, `${JSON.stringify(generatedReference, null, 2)}\n`, 'utf8')

  const activeRecordNumbers = new Set(Object.values(activeMoveIndex))
  const qaHeaders = [
    'record_no', 'scope', 'move_id', 'move_key', 'variant', 'required_manual_variants',
    'reference_availability', 'reference_fidelity', 'runtime_coverage', 'animation_found',
    'graphics_found', 'audio_found', 'compile_ok', 'single_battle_ok', 'double_battle_ok',
    'enemy_side_ok', 'duration_ticks', 'last_visible_tick', 'camera_restored',
    'background_restored', 'battler_visibility_restored', 'exception', 'reference_timecode',
    'reference_frame_hash', 'capture_frame_hash', 'pixel_diff_ratio', 'review_status', 'review_notes',
  ]
  const qaRows = records.map((record) => {
    const activeMoveId = Object.keys(activeMoveIndex).find((moveId) => activeMoveIndex[moveId] === record.recordNo)
    const resource = activeMoveId ? animationManifest.moves[activeMoveId] : null
    const runtimeCoverage = resource?.specific
      ? 'DEDICATED_EBDX'
      : resource
        ? 'EBDX_FALLBACK'
        : activeRecordNumbers.has(record.recordNo)
          ? 'PROCEDURAL_REFERENCE'
          : 'NOT_IN_ACTIVE_BATTLE_CATALOG'
    return [
      record.recordNo,
      record.scope,
      record.moveId,
      record.moveKey,
      record.variant,
      record.manualVariants.join('|'),
      record.availability,
      record.fidelity,
      runtimeCoverage,
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      'NOT_TESTED',
      '',
    ].map(csvEscape).join(',')
  })
  writeFileSync(qaOutputPath, `${qaHeaders.join(',')}\n${qaRows.join('\n')}\n`, 'utf8')

  console.log(`Imported ${records.length} animation references from ${path.basename(sourcePath)}.`)
  console.log(`Matched ${Object.keys(activeMoveIndex).length}/${battleMoveData.moves.length} active battle moves.`)
  console.log(`Runtime index: ${path.relative(rootDirectory, runtimeOutputPath)}`)
  console.log(`QA checklist: ${path.relative(rootDirectory, qaOutputPath)}`)
}

main()
