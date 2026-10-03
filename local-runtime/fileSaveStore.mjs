import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { createSave, MAX_SAVE_BYTES, validateSave } from '../src/local/saveSchema.js'

export function createFileSaveStore(directory) {
  const dataDirectory = path.resolve(directory)
  const savePath = path.join(dataDirectory, 'main.json')
  const backupPath = path.join(dataDirectory, 'main.backup.json')
  let queue = Promise.resolve()
  const read = async () => {
    let text
    try {
      if ((await stat(savePath)).size > MAX_SAVE_BYTES) throw new Error('저장 파일의 최대 크기를 초과했습니다.')
      text = await readFile(savePath, 'utf8')
    } catch (error) { if (error.code === 'ENOENT') return null; throw error }
    try { return validateSave(JSON.parse(text)) }
    catch { throw new Error('로컬 저장 파일이 손상됐습니다. main.json과 main.backup.json을 보존한 뒤 백업을 복원해주세요.') }
  }
  return {
    kind: 'file', location: savePath, savePath, backupPath, read,
    write(save, expectedRevision, { reason } = {}) {
      const operation = queue.then(async () => {
        validateSave(save)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw new Error('저장 버전이 올바르지 않습니다.')
        const previous = await read()
        if ((previous?.revision ?? 0) !== expectedRevision) throw new Error('다른 게임 창에서 기록이 변경됐습니다. 이 창을 다시 실행해주세요.')
        const next = createSave(save.values, expectedRevision + 1)
        await mkdir(dataDirectory, { recursive: true })
        const temp = path.join(dataDirectory, `.main-${randomUUID()}.tmp`)
        const backupTemp = `${temp}.backup`
        try {
          const file = await open(temp, 'wx', 0o600)
          try { await file.writeFile(`${JSON.stringify(next)}\n`, 'utf8'); await file.sync() } finally { await file.close() }
          if (previous) {
            await copyFile(savePath, backupTemp)
            await rename(backupTemp, backupPath)
            if (reason === 'import') {
              await copyFile(savePath, backupTemp)
              await rename(backupTemp, path.join(dataDirectory, 'before-import.json'))
            }
          }
          await rename(temp, savePath)
          return next
        } finally { await rm(temp, { force: true }); await rm(backupTemp, { force: true }) }
      })
      queue = operation.catch(() => {})
      return operation
    },
    async idle() { await queue },
  }
}

// Prevent two reference runtimes from racing their read/compare/write cycles.
export async function acquireSaveDirectoryLock(directory) {
  const root = path.resolve(directory)
  await mkdir(root, { recursive: true })
  const lockPath = path.join(root, '.runtime.lock')
  let handle
  try { handle = await open(lockPath, 'wx', 0o600) }
  catch (error) {
    if (error.code !== 'EEXIST') throw error
    let pid
    try { pid = Number(await readFile(lockPath, 'utf8')) } catch {}
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('로컬 저장 폴더가 잠겨 있습니다. 기존 실행 창을 확인해주세요.')
    let alive = true
    try { process.kill(pid, 0) } catch (failure) { if (failure.code === 'ESRCH') alive = false }
    if (alive) throw new Error('같은 저장 폴더의 게임이 이미 실행 중입니다.')
    await rm(lockPath)
    handle = await open(lockPath, 'wx', 0o600)
  }
  await handle.writeFile(String(process.pid))
  return async () => { await handle.close(); await rm(lockPath, { force: true }) }
}
