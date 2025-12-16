declare module 'sql.js/dist/sql-wasm.js' {
  import type { SqlJsStatic } from 'sql.js';
  const initSqlJs: (config?: any) => Promise<SqlJsStatic>;
  export default initSqlJs;
}

