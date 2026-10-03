import { validateSave } from './saveSchema.js'

export async function createIndexedDbBackend(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) throw new Error('로컬 저장소를 사용할 수 없습니다. 런처로 실행하거나 저장 권한을 확인해주세요.')
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('champions-arena-local-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('saves')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('다른 게임 창을 닫은 뒤 다시 실행해주세요.'))
  })
  return {
    kind: 'indexeddb', location: '이 기기의 개발용 로컬 저장소',
    read() {
      return new Promise((resolve, reject) => {
        const request = db.transaction('saves').objectStore('saves').get('main')
        request.onsuccess = () => { try { resolve(request.result == null ? null : validateSave(request.result)) } catch (error) { reject(error) } }
        request.onerror = () => reject(request.error)
      })
    },
    write(save, expectedRevision, { reason } = {}) {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction('saves', 'readwrite')
        const store = transaction.objectStore('saves')
        let failure, next
        const request = store.get('main')
        request.onsuccess = () => {
          try {
            const previous = request.result == null ? null : validateSave(request.result)
            if ((previous?.revision ?? 0) !== expectedRevision) throw new Error('다른 게임 창에서 기록이 변경됐습니다. 이 창을 다시 실행해주세요.')
            next = validateSave({ ...save, revision: expectedRevision + 1, updatedAt: Date.now() })
            if (previous) { store.put(previous, 'backup'); if (reason === 'import') store.put(previous, 'before-import') }
            store.put(next, 'main')
          } catch (error) { failure = error; transaction.abort() }
        }
        transaction.oncomplete = () => resolve(next)
        transaction.onerror = transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('로컬 저장에 실패했습니다.'))
      })
    },
    close() { db.close() },
  }
}
