/** Legacy and deliberately-untyped .jsx modules. Colony's page stays .jsx for
 *  the foreseeable future, so this file is permanent, not transitional. */
declare module '*.jsx' {
  import type { ComponentType } from 'react';
  // `any`, not a props record: an interface like ExperimentPageProps has no
  // index signature, so ComponentType<Record<string, unknown>> fails to
  // satisfy RegistryEntry['load'] under strict function-type checks even
  // though the untyped .jsx component happily ignores whatever it's passed.
  const Component: ComponentType<any>;
  export default Component;
}
