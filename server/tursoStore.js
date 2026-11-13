import { createClient } from '@libsql/client/web'
import { createD1DocumentApi } from '../cloudflare/document-store.mjs'
import { createCloudflareStore } from './cloudflareStore.js'

function result(response) {
  return { results: response.rows, meta: { changes: response.rowsAffected } }
}

function sqliteBinding(client) {
  return {
    prepare(sql) {
      return {
        bind(...args) {
          const statement = { sql, args }
          return {
            ...statement,
            async first() {
              return (await client.execute(statement)).rows[0] ?? null
            },
          }
        },
      }
    },
    async batch(statements) {
      const mode = statements.every(statement => /^\s*SELECT\b/i.test(statement.sql)) ? 'read' : 'write'
      const queries = statements.map(({ sql, args }) => ({ sql, args }))
      return (await client.batch(queries, mode)).map(result)
    },
  }
}

export function createTursoClient({ url, authToken, fetchImpl = fetch }) {
  const endpoint = new URL(url)
  if (!['libsql:', 'https:'].includes(endpoint.protocol)
      || !endpoint.hostname.endsWith('.turso.io')
      || endpoint.username || endpoint.password || endpoint.port
      || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)
      || typeof authToken !== 'string' || !authToken) {
    throw new TypeError('Turso storage is not configured')
  }
  return createClient({
    url: endpoint.href,
    authToken,
    fetch: (input, options) => fetchImpl(input, {
      ...options,
      redirect: 'error',
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(10_000)])
        : AbortSignal.timeout(10_000),
    }),
  })
}

export function createTursoStore({ client, namespace }) {
  const documentApi = createD1DocumentApi(sqliteBinding(client))
  return createCloudflareStore({
    namespace,
    async request(command) {
      try {
        return await documentApi(command)
      } catch (error) {
        if (['STORE_CONFLICT', 'INVALID'].includes(error?.code)) throw error
        // A transport failure may arrive after a commit. Only the guarded
        // SQLite conflict can restart a transaction through the shared store.
        throw Object.assign(new Error('Turso storage unavailable'), {
          code: 'STORE_UNAVAILABLE',
          storeAction: command.action,
        })
      }
    },
  })
}
