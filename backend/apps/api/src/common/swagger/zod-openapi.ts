import { applyDecorators } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiCreatedResponse, ApiQuery } from '@nestjs/swagger';
import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

export function toOpenApi(schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonSchema {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  return json;
}

export const ApiZodBody = (schema: z.ZodType) =>
  ApiBody({ schema: toOpenApi(schema, 'input') as never });

export const ApiZodOk = (schema: z.ZodType, description?: string) =>
  ApiOkResponse({ schema: toOpenApi(schema) as never, description });

export const ApiZodCreated = (schema: z.ZodType, description?: string) =>
  ApiCreatedResponse({ schema: toOpenApi(schema) as never, description });

export function ApiZodQuery(schema: z.ZodObject) {
  const json = toOpenApi(schema, 'input') as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return applyDecorators(
    ...Object.entries(json.properties ?? {}).map(([name, prop]) =>
      ApiQuery({
        name,
        required: json.required?.includes(name) ?? false,
        schema: prop as never,
        description: prop.description as string | undefined,
      }),
    ),
  );
}
