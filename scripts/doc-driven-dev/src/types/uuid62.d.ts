declare module "uuid62" {
  function encode(uuid: string): string;
  function decode(encoded: string): string;
  function v1(): string;
  function v4(): string;
  const uuid62: {
    encode: typeof encode;
    decode: typeof decode;
    v1: typeof v1;
    v4: typeof v4;
  };
  export default uuid62;
}
