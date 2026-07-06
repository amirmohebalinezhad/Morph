// esbuild is configured with `loader: { '.css': 'text' }`.
declare module '*.css' {
  const text: string;
  export default text;
}
