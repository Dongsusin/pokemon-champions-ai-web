import { useEffect } from 'react'
import PokemonUsageScreen from './PokemonUsageScreen'

export default function PokemonUsagePanel({ usage, ...props }) {
  useEffect(() => { void usage.refresh() }, [usage.refresh])
  return <PokemonUsageScreen {...props} snapshot={usage.snapshot} loading={usage.loading}
    error={usage.error} onRefresh={usage.refresh} />
}
