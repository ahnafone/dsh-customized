/** Locale-owned sandbox approval text; audit inputs remain verbatim. */

/** English escalation messages. */
export const en = {
  escalation: (mode: string, justification: string): string => `Allow this operation with ${mode} permissions: ${justification}`,
  folderEscalation: (root: string, justification: string): string => `Allow this operation under ${root} for one day: ${justification}`,
}

/** Chinese escalation messages. */
export const zh = {
  escalation: (mode: string, justification: string): string => `允许本次操作使用 ${mode} 权限：${justification}`,
  folderEscalation: (root: string, justification: string): string => `允许在 ${root} 下执行本次操作一天：${justification}`,
} satisfies typeof en

/** Japanese escalation messages. */
export const ja = {
  escalation: (mode: string, justification: string): string => `${mode} 権限でこの操作を許可します：${justification}`,
  folderEscalation: (root: string, justification: string): string => `${root} の下でこの操作を 1 日許可します：${justification}`,
} satisfies typeof en

/** Spanish dictionary, checked against the English keys. */
export const es = {
  escalation: (mode: string, justification: string): string => `Permitir esta operación con permisos ${mode}: ${justification}`,
  folderEscalation: (root: string, justification: string): string => `Permitir esta operación en ${root} durante un día: ${justification}`,
} satisfies typeof en

/** French dictionary, checked against the English keys. */
export const fr = {
  escalation: (mode: string, justification: string): string => `Autoriser cette opération avec les permissions ${mode} : ${justification}`,
  folderEscalation: (root: string, justification: string): string => `Autoriser cette opération sous ${root} pendant un jour : ${justification}`,
} satisfies typeof en

/** German dictionary, checked against the English keys. */
export const de = {
  escalation: (mode: string, justification: string): string => `Diesen Vorgang mit ${mode}-Berechtigungen zulassen: ${justification}`,
  folderEscalation: (root: string, justification: string): string => `Diesen Vorgang für einen Tag unter ${root} zulassen: ${justification}`,
} satisfies typeof en

/** Russian dictionary, checked against the English keys. */
export const ru = {
  escalation: (mode: string, justification: string): string => `Разрешить эту операцию с правами ${mode}: ${justification}`,
  folderEscalation: (root: string, justification: string): string => `Разрешить эту операцию в ${root} на один день: ${justification}`,
} satisfies typeof en

/** Portuguese dictionary, checked against the English keys. */
export const pt = {
  escalation: (mode: string, justification: string): string => `Permitir esta operação com permissões ${mode}: ${justification}`,
  folderEscalation: (root: string, justification: string): string => `Permitir esta operação em ${root} por um dia: ${justification}`,
} satisfies typeof en

/**
 * Build translations for the existing Client localized-text resolver.
 * @param mode - requested sandbox mode.
 * @param justification - raw model justification, preserved in every translation.
 * @returns localized approval text.
 */
export function escalationDisplayReason(mode: string, justification: string): Record<'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt', string> {
  return {
    en: en.escalation(mode, justification),
    zh: zh.escalation(mode, justification),
    ja: ja.escalation(mode, justification),
    es: es.escalation(mode, justification),
    fr: fr.escalation(mode, justification),
    de: de.escalation(mode, justification),
    ru: ru.escalation(mode, justification),
    pt: pt.escalation(mode, justification),
  }
}

/**
 * Build translations for a folder-scoped escalation ask.
 * @param root - the physical directory the user is asked to grant.
 * @param justification - raw model justification, preserved in every translation.
 * @returns localized approval text.
 */
export function folderEscalationDisplayReason(root: string, justification: string): Record<'en' | 'zh' | 'ja' | 'es' | 'fr' | 'de' | 'ru' | 'pt', string> {
  return {
    en: en.folderEscalation(root, justification),
    zh: zh.folderEscalation(root, justification),
    ja: ja.folderEscalation(root, justification),
    es: es.folderEscalation(root, justification),
    fr: fr.folderEscalation(root, justification),
    de: de.folderEscalation(root, justification),
    ru: ru.folderEscalation(root, justification),
    pt: pt.folderEscalation(root, justification),
  }
}
