// Guided tutorial: a fixed 3×3 board and scripted steps. Each step glows one
// target arrow and advances when tapping it produces the expected result.
//
//   A A B      A (orange) points right but B is in the way.
//   . C .      B (blue) points up and can leave at once.
//   C C .      C (green) bends and points up, blocked by A.

export const TUTORIAL_LEVEL = {
  level: 0,
  size: 3,
  arrows: [
    { id: 0, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }], dir: 'right', color: 1 },
    { id: 1, cells: [{ x: 2, y: 0 }], dir: 'up', color: 5 },
    { id: 2, cells: [{ x: 0, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }], dir: 'up', color: 3 },
  ],
};

export const TUTORIAL_STEPS = [
  {
    target: 0,
    expect: 'blocked',
    text: 'Toca la flecha que brilla. Cada flecha se desliza hacia donde apunta.',
  },
  {
    target: 1,
    expect: 'exit',
    text: '¡Rebotó! Otra flecha le cierra el paso. Chocar no cuesta nada. Saca primero la que estorba.',
  },
  {
    target: 0,
    expect: 'exit',
    text: '¡Muy bien! Ahora la primera tiene el camino libre. Tócala otra vez.',
  },
  {
    target: 2,
    expect: 'exit',
    text: 'Las flechas con curva avanzan como una serpiente: solo importa hacia dónde apunta la cabeza.',
  },
];

export const TUTORIAL_DONE =
  '¡Tablero vacío! Así se gana cada nivel. Si te atascas, usa Pista o Deshacer. Sin prisa.';
