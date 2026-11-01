import type { paths } from "./api-schema";

type JsonBody<R> = R extends { content: { "application/json": infer B } } ? B : never;

export type ApiOk<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  responses: infer R;
}
  ? JsonBody<R extends { 200: infer O } ? O : R extends { 201: infer C } ? C : never>
  : never;
