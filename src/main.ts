import { feature } from 'topojson-client';
import { loadDerivedData, loadIndiaTopo } from './data/load';
import type { DerivedData, GeoFeatureCollection } from './data/types';
import { Router, type RouteName } from './router';
import { renderCancerView } from './ui/viewCancer';
import { renderCuisineView } from './ui/viewCuisine';
import { renderCompareView } from './ui/viewCompare';
import './ui/app.css';

async function bootstrap() {
  const [data, topo] = await Promise.all([loadDerivedData(), loadIndiaTopo()]);
  const geo = feature(topo, topo.objects.states) as unknown as GeoFeatureCollection;

  const app = document.getElementById('app');
  const nav = document.getElementById('nav');
  if (!app || !nav) return;

  nav.innerHTML = '';
  const tabs: { route: RouteName; label: string }[] = [
    { route: 'cancer', label: 'Cancer' },
    { route: 'cuisine', label: 'Cuisine' },
    { route: 'compare', label: 'Compare' }
  ];

  const router = new Router();

  tabs.forEach(tab => {
    const link = document.createElement('a');
    link.href = `#/` + tab.route;
    link.textContent = tab.label;
    link.addEventListener('click', event => {
      event.preventDefault();
      router.navigate(tab.route);
    });
    nav.appendChild(link);
  });

  let cleanup: (() => void) | null = null;

  router.onChange(route => {
    nav.querySelectorAll('a').forEach(link => {
      if ((link as HTMLAnchorElement).hash === `#/${route}`) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    cleanup?.();
    cleanup = renderRoute(route, app, data, geo);
  });

  if (!window.location.hash) {
    router.navigate('cancer');
  } else {
    router.navigate((window.location.hash.slice(2) as RouteName) || 'cancer');
  }
}

function renderRoute(route: RouteName, container: HTMLElement, data: DerivedData, geo: GeoFeatureCollection) {
  switch (route) {
    case 'cancer':
      return renderCancerView({ container, data, geo });
    case 'cuisine':
      return renderCuisineView({ container, data, geo });
    case 'compare':
      return renderCompareView({ container, data, geo });
    default:
      return renderCancerView({ container, data, geo });
  }
}

bootstrap();
