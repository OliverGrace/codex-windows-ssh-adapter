import {inspectDesktop} from './desktop-compat.mjs';
try {
  const [version,installLocation,format]=process.argv.slice(2);
  if(Boolean(version)!==Boolean(installLocation))throw Error('Provide both package version and installation directory');
  const desktop=inspectDesktop(version?{Version:version,InstallLocation:installLocation}:undefined);
  console.log(format==='--json'?JSON.stringify({version:desktop.version,checks:desktop.checks,
    startupConfigRefreshSupported:desktop.startupConfigRefreshSupported}):
    `OK Desktop ${desktop.version}: ${desktop.checks} SSH protocol checks passed`);
} catch(error) {
  console.error('Desktop SSH compatibility check failed: '+error.message);
  process.exitCode=1;
}
