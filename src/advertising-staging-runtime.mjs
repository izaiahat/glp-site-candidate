import {createConsentRuntimeSource} from './consent-runtime.mjs';
import {createAdvertisingConsentAdapter} from '../assets/advertising-consent-adapter.mjs';
import {installAdvertisingLoaders,eligibleAdvertisingProjection} from './advertising-loaders.mjs';

// Build-time staging emitter. Never selected by the default consumer builder.
// The defer flag is for code-owned late installation, not browser configuration.
export function createStagedAdvertisingRuntimeSource({deferLoaders=false}={}) {
 return `(async()=>{
  if(!/^https:\\/\\/a17-(?:meta|microsoft)\\.invalid$/.test(location.origin)||location.pathname!=='/test/administrative/'||location.search||location.hash){${createConsentRuntimeSource()}return;}
  const createAdvertisingConsentAdapter=${createAdvertisingConsentAdapter.toString()};
  const eligibleAdvertisingProjection=${eligibleAdvertisingProjection.toString()};
  const installedLoaders=new WeakMap();
  const installAdvertisingLoaders=${installAdvertisingLoaders.toString()};
  const adapter=createAdvertisingConsentAdapter();
  try{await adapter.refresh()}catch{}
  ${createConsentRuntimeSource('adapter')}
  await window.GCSConsentReady;
  const install=()=>installAdvertisingLoaders({adapter,consent:window.GCSConsent});
  window.addEventListener('gcs:advertising-install',install);
  ${deferLoaders?'':'install();'}
 })()`;
}
