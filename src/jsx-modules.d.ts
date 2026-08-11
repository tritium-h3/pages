/** Legacy and deliberately-untyped .jsx modules. Colony's page stays .jsx for
 *  the foreseeable future, so this file is permanent, not transitional. */
declare module '*.jsx' {
  import type { ComponentType } from 'react';
  const Component: ComponentType<Record<string, unknown>>;
  export default Component;
}
