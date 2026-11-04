import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'tools/**', 'next-env.d.ts'] },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Two React-Compiler advisories added by eslint-plugin-react-hooks 7 flag patterns this code base uses on purpose: loading data in an effect (an external system) and spreading
    // react-hook-form's register() (reports a ref read during render, a known false positive). The code is not compiled with the React Compiler.
    rules: { 'react-hooks/set-state-in-effect': 'off', 'react-hooks/refs': 'off' },
  },
];
