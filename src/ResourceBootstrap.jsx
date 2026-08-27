import ResourceLoadingScreen from './ResourceLoadingScreen'
import { useResourcePreloader } from './resourcePreloader'

function ResourceBootstrap({ children }) {
  const resourceState = useResourcePreloader()
  if (resourceState.status !== 'complete') {
    return <ResourceLoadingScreen state={resourceState} />
  }
  return children
}

export default ResourceBootstrap
