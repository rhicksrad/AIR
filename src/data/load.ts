import type { DerivedData } from './types';

export async function loadDerivedData(): Promise<DerivedData> {
  const [cancer, cuisine, joined] = await Promise.all([
    fetch('/derived/cancer_by_state.json').then(r => r.json()),
    fetch('/derived/cuisine_by_state.json').then(r => r.json()),
    fetch('/derived/joined_state_metrics.json').then(r => r.json())
  ]);
  return { cancer, cuisine, joined };
}

export async function loadIndiaTopo(): Promise<any> {
  const topo = await fetch('/geo/india_states.topo.json').then(r => r.json());
  return topo;
}
