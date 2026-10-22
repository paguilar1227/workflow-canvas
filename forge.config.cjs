const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
const { MakerDMG } = require('@electron-forge/maker-dmg');
const { MakerZIP } = require('@electron-forge/maker-zip');
module.exports = {
  packagerConfig: {
    asar: true,
    name: 'Workflow Canvas',
    executableName: 'workflow-canvas',
    appBundleId: 'com.paguilar.workflowcanvas',
    appCategoryType: 'public.app-category.productivity',
    icon: undefined,
    ignore: [/^\/(src|e2e|test-results|playwright-report|evidence|\.git|\.github|out|data)(\/|$)/, /^\/\.scratch/, /^\/scripts/],
    ...(process.env.APPLE_SIGN_IDENTITY ? { osxSign: { identity: process.env.APPLE_SIGN_IDENTITY }, ...(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID ? { osxNotarize: { appleId: process.env.APPLE_ID, appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD, teamId: process.env.APPLE_TEAM_ID } } : {}) } : { osxSign: { identity: '-', identityValidation: false, preAutoEntitlements: false, preEmbedProvisioningProfile: false, continueOnError: false, optionsForFile: () => ({ hardenedRuntime: false }) } }),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ name: 'WorkflowCanvas', setupExe: 'Workflow-Canvas-Setup.exe', ...(process.env.WINDOWS_CERTIFICATE_FILE ? { certificateFile: process.env.WINDOWS_CERTIFICATE_FILE, certificatePassword: process.env.WINDOWS_CERTIFICATE_PASSWORD } : {}) }),
    new MakerDMG({ name: 'Workflow Canvas' }),
    new MakerZIP({}, ['darwin', 'win32', 'linux']),
  ],
};
