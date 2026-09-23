export type RuntimeState = 'checking' | 'online' | 'offline';

export type V2ViewKey = 'trabalho' | 'equipe' | 'conexoes' | 'configuracoes' | 'system';
export type LegacyViewKey =
  | 'office'
  | 'chat'
  | 'orchestrator'
  | 'teams'
  | 'workforces'
  | 'integrations'
  | 'projects'
  | 'analytics';

export type ViewKey = V2ViewKey | LegacyViewKey;

export interface NavItem {
  key: ViewKey;
  label: string;
  icon: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { key: 'trabalho', label: 'Trabalho', icon: '◌' },
  { key: 'equipe', label: 'Equipe', icon: '◉' },
  { key: 'conexoes', label: 'Conexões', icon: '⇄' },
  { key: 'configuracoes', label: 'Configurações', icon: '⚙' },
];

export const LEGACY_NAV: NavItem[] = [
  { key: 'office', label: 'Sala (Office)', icon: '⌂' },
  { key: 'chat', label: 'Chat antigo', icon: '◌' },
  { key: 'orchestrator', label: 'Orquestrador', icon: '◆' },
  { key: 'teams', label: 'Teams', icon: '◎' },
  { key: 'workforces', label: 'Workforces', icon: '◇' },
  { key: 'integrations', label: 'Integrações', icon: '⇄' },
  { key: 'projects', label: 'Projetos', icon: '□' },
  { key: 'analytics', label: 'Analytics', icon: '↯' },
];

export function activePrimaryKey(view: ViewKey): V2ViewKey | null {
  switch (view) {
    case 'trabalho':
    case 'office':
    case 'chat':
      return 'trabalho';
    case 'equipe':
      return 'equipe';
    case 'conexoes':
      return 'conexoes';
    case 'configuracoes':
      return 'configuracoes';
    default:
      return null;
  }
}

export function runtimeLabel(state: RuntimeState): string {
  if (state === 'online') return 'Sistema online';
  if (state === 'offline') return 'Sistema offline';
  return 'Verificando sistema';
}
