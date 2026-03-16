declare module "docxtemplater/expressions.js" {
  const expressionParser: {
    (tag: string): any;
    filters: Record<string, (value: unknown) => string>;
  };
  export default expressionParser;
}
