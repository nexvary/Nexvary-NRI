const routeGroups = [
  [[], ['login', 'logout', 'settings', 'settings-privacy', 'settings-mfa', 'settings-licensing', 'control-billing', 'control-operations', 'settings-message-moderation']],
  [[2], ['index', 'project', 'delete']],
  [[3], ['documents', 'document', 'delete-document', 'download-document', 'preview-document', 'library-collections', 'library-reading']],
  [[3, 4], ['library', 'citations']],
  [[4], ['reference-projects', 'references']],
  [[4, 5], ['evidence']],
  [[5], ['evidence-projects', 'evidence-export']],
  [[5, 6], ['readiness']],
  [[6], ['readiness-projects']],
  [[7], ['economics-projects', 'economics', 'economics-export']],
  [[4, 8], ['assistant', 'assistant-answer']],
  [[8], ['assistant-settings']],
  [[9], ['network']],
  [[9, 10], ['collaboration']],
  [[10], ['team-inbox', 'team-work', 'sharing-inbox', 'sharing-manage', 'sharing-project']],
  [[2, 5, 6, 10], ['team-project']],
  [[3, 4, 5, 6, 10, 15], ['shared-resources']],
  [[11], ['messages', 'messages-thread']],
  [[12], ['observatory', 'observatory-topic']],
  [[13], ['analytics']],
  [[14], ['education']],
  [[15], ['report-projects']],
  [[4, 5, 6, 15], ['reports']],
];

const routeModules = new Map(routeGroups.flatMap(([modules, kinds]) =>
  kinds.map((kind) => [kind, modules])));

export const dashboardModules = Object.freeze([1, 2, 3, 4, 5, 8, 9]);
export const configurableModules = Object.freeze(Array.from({ length: 15 }, (_, index) => index + 1));

export function allowsRoute(licensing, account, kind) {
  const required = routeModules.get(kind);
  return required !== undefined && licensing.allowsModules(account, required);
}
