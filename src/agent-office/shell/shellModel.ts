export type RuntimeState = 'checking' | 'online' | 'offline';

export type ViewKey = 'trabalho' | 'equipe' | 'conexoes' | 'configuracoes' | 'system' | 'projects';

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

export function activePrimaryKey(view: ViewKey): ViewKey | null {
  if (view === 'trabalho' || view === 'equipe' || view === 'conexoes' || view === 'configuracoes') return view;
  return null;
}

export function runtimeLabel(state: RuntimeState): string {
  if (state === 'online') return 'Sistema online';
  if (state === 'offline') return 'Sistema offline';
  return 'Verificando sistema';
}
