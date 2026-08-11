/** Legacy and deliberately-untyped .jsx modules. Colony's page stays .jsx for
 *  the foreseeable future, so this file is permanent, not transitional. */
declare module '*.jsx' {
  import type { FunctionComponent } from 'react';
  // FunctionComponent, not ComponentType: the latter's ComponentClass arm has a
  // construct signature that is invariant in P, so ComponentType<unknown> fails
  // to accept a concrete page. Both .jsx consumers are function components, and
  // this is tighter than widening to `any` — which would be a permanent hole
  // covering every future .jsx module.
  const Component: FunctionComponent<unknown>;
  export default Component;
}
