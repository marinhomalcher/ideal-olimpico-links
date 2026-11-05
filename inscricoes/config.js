/* Trocar pelo endpoint /api do Worker separado de produção antes da publicação. */
window.PORTAL_PROXY_PRODUCTION_CONFIG=Object.freeze({
  apiUrl:'https://replace-before-release.invalid/api'
});