type RouteHandler = () => void;

export type RouteName = 'cancer' | 'cuisine' | 'compare';

const routes: Record<string, RouteName> = {
  '#/cancer': 'cancer',
  '#/cuisine': 'cuisine',
  '#/compare': 'compare'
};

export class Router {
  private handler: ((route: RouteName) => void) | null = null;

  constructor() {
    window.addEventListener('hashchange', () => this.emit());
  }

  onChange(handler: (route: RouteName) => void) {
    this.handler = handler;
    this.emit();
  }

  navigate(route: RouteName) {
    const hash = Object.entries(routes).find(([, name]) => name === route)?.[0] ?? '#/cancer';
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    } else {
      this.emit();
    }
  }

  private emit() {
    if (!this.handler) return;
    const route = routes[window.location.hash] ?? 'cancer';
    this.handler(route);
  }
}
