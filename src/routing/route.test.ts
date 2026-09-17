import { describe, expect, it } from 'vitest';
import { resolveRoute } from './route';

describe('resolveRoute', () => {
  it('la raiz es la oficina', () => {
    expect(resolveRoute('/')).toBe('office');
  });

  it('/dashboard es el panel', () => {
    expect(resolveRoute('/dashboard')).toBe('dashboard');
  });

  it('/dashboard/ con barra final es la misma ruta', () => {
    // Un enlace copiado a mano acaba con barra tan facil como sin ella, y
    // caer a la oficina por un caracter seria un fallo desconcertante.
    expect(resolveRoute('/dashboard/')).toBe('dashboard');
  });

  it('las mayusculas no cuentan: la ruta se compara en minusculas', () => {
    expect(resolveRoute('/Dashboard')).toBe('dashboard');
    expect(resolveRoute('/DASHBOARD/')).toBe('dashboard');
  });

  it('una subruta del panel todavia no existe: cae a la oficina', () => {
    // Deliberado: no hay enrutado anidado. Inventar aqui un prefijo abriria
    // rutas que ningun componente sabe pintar.
    expect(resolveRoute('/dashboard/invitaciones')).toBe('office');
  });

  it('una ruta que solo empieza igual no es el panel', () => {
    expect(resolveRoute('/dashboards')).toBe('office');
    expect(resolveRoute('/dashboard-viejo')).toBe('office');
  });

  it('cualquier otra ruta es la oficina', () => {
    expect(resolveRoute('')).toBe('office');
    expect(resolveRoute('/oficina')).toBe('office');
    expect(resolveRoute('/admin')).toBe('office');
  });

  it('ignora barras repetidas al final', () => {
    expect(resolveRoute('/dashboard//')).toBe('office');
  });
});
