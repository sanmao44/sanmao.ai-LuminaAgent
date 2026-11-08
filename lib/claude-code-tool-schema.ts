import { z, type ZodRawShape, type ZodType } from 'zod';

type SupportedResult = {
  supported: true;
  shape: ZodRawShape;
  validate: (input: unknown) => boolean;
};

type UnsupportedResult = { supported: false; reason: string };

type JsonSchema = Record<string, unknown>;

const ANNOTATION_KEYS = new Set(['$comment', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly']);
const COMMON_KEYS = new Set(['type', 'enum', 'nullable', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'format', 'properties', 'required', 'items', 'additionalProperties', 'anyOf']);
const OBJECT_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties']);

class UnsupportedSchemaError extends Error {}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unsupported(path: string, keyword: string): never {
  throw new UnsupportedSchemaError(`${path}: unsupported JSON Schema keyword "${keyword}"`);
}

function assertKnownKeys(schema: JsonSchema, path: string, allowed: ReadonlySet<string>) {
  for (const key of Object.keys(schema)) {
    if (!allowed.has(key) && !ANNOTATION_KEYS.has(key)) unsupported(path, key);
  }
}

function finiteConstraint(schema: JsonSchema, key: string, path: string) {
  const value = schema[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) unsupported(path, key);
  return value;
}

function integerConstraint(schema: JsonSchema, key: string, path: string) {
  const value = finiteConstraint(schema, key, path);
  if (value !== undefined && (!Number.isInteger(value) || value < 0)) unsupported(path, key);
  return value;
}

function isUri(value: string) {
  try {
    const parsed = new URL(value);
    return Boolean(parsed.protocol);
  } catch {
    return false;
  }
}

function zodUnion(schemas: ZodType[]): ZodType {
  if (schemas.length === 1) return schemas[0]!;
  return z.union(schemas as [ZodType, ZodType, ...ZodType[]]);
}

function objectSchema(schema: JsonSchema, path: string): z.ZodObject<ZodRawShape> {
  assertKnownKeys(schema, path, OBJECT_KEYS);
  if (schema.type !== 'object') unsupported(path, 'type');
  const properties = schema.properties === undefined ? {} : schema.properties;
  if (!isRecord(properties)) unsupported(path, 'properties');
  const requiredValue = schema.required === undefined ? [] : schema.required;
  if (!Array.isArray(requiredValue) || requiredValue.some((key) => typeof key !== 'string')) unsupported(path, 'required');
  const required = new Set(requiredValue as string[]);
  for (const key of required) {
    if (!(key in properties)) unsupported(path, `required.${key}`);
  }

  const shape: Record<string, ZodType> = {};
  for (const [key, propertySchema] of Object.entries(properties)) {
    const child = convertSchema(propertySchema, `${path}.properties.${key}`);
    shape[key] = required.has(key) ? child : child.optional();
  }

  let result = z.object(shape);
  if (schema.additionalProperties === false) result = result.strict();
  else if (schema.additionalProperties === undefined || schema.additionalProperties === true) result = result.passthrough();
  else unsupported(path, 'additionalProperties');

  return result;
}

function convertSchema(value: unknown, path: string): ZodType {
  if (!isRecord(value)) unsupported(path, 'schema');
  assertKnownKeys(value, path, COMMON_KEYS);

  const declaredType = value.type;
  const types = declaredType === undefined
    ? []
    : Array.isArray(declaredType)
      ? declaredType
      : [declaredType];
  if (!types.length || types.some((type) => typeof type !== 'string')) unsupported(path, 'type');
  if (value.nullable !== undefined && typeof value.nullable !== 'boolean') unsupported(path, 'nullable');

  const enumValues = value.enum;
  if (enumValues !== undefined && (!Array.isArray(enumValues) || enumValues.length === 0 || enumValues.some((entry) => entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)))) {
    unsupported(path, 'enum');
  }

  const min = finiteConstraint(value, 'minimum', path);
  const max = finiteConstraint(value, 'maximum', path);
  const minLength = integerConstraint(value, 'minLength', path);
  const maxLength = integerConstraint(value, 'maxLength', path);
  const minItems = integerConstraint(value, 'minItems', path);
  const maxItems = integerConstraint(value, 'maxItems', path);
  if (min !== undefined && max !== undefined && min > max) unsupported(path, 'minimum/maximum');
  if (minLength !== undefined && maxLength !== undefined && minLength > maxLength) unsupported(path, 'minLength/maxLength');
  if (minItems !== undefined && maxItems !== undefined && minItems > maxItems) unsupported(path, 'minItems/maxItems');

  const schemas: ZodType[] = [];
  for (const type of types) {
    switch (type) {
      case 'string': {
        let field = z.string();
        if (minLength !== undefined) field = field.min(minLength);
        if (maxLength !== undefined) field = field.max(maxLength);
        if (value.format !== undefined) {
          if (value.format !== 'uri') unsupported(path, 'format');
          field = field.refine(isUri, { message: 'Expected an absolute URI' });
        }
        schemas.push(field);
        break;
      }
      case 'number':
      case 'integer': {
        let field = z.number();
        if (type === 'integer') field = field.int();
        if (min !== undefined) field = field.min(min);
        if (max !== undefined) field = field.max(max);
        schemas.push(field);
        break;
      }
      case 'boolean':
        schemas.push(z.boolean());
        break;
      case 'null':
        schemas.push(z.null());
        break;
      case 'array': {
        const itemSchema = value.items === undefined ? z.unknown() : convertSchema(value.items, `${path}.items`);
        let field = z.array(itemSchema);
        if (minItems !== undefined) field = field.min(minItems);
        // file_generate's legacy schema uses `maximum` for an array length cap.
        const legacyMaxItems = types.length === 1 ? max : undefined;
        if (maxItems !== undefined || legacyMaxItems !== undefined) field = field.max(maxItems ?? legacyMaxItems!);
        schemas.push(field);
        break;
      }
      case 'object':
        schemas.push(objectSchema({
          type: 'object',
          ...(value.properties === undefined ? {} : { properties: value.properties }),
          ...(value.required === undefined ? {} : { required: value.required }),
          ...(value.additionalProperties === undefined ? {} : { additionalProperties: value.additionalProperties }),
        }, path));
        break;
      default:
        unsupported(path, `type.${String(type)}`);
    }
  }

  if (value.format !== undefined && !types.includes('string')) unsupported(path, 'format');
  if ((minLength !== undefined || maxLength !== undefined) && !types.includes('string')) unsupported(path, 'minLength/maxLength');
  if ((minItems !== undefined || maxItems !== undefined) && !types.includes('array')) unsupported(path, 'minItems/maxItems');
  const hasNumericType = types.some((type) => type === 'number' || type === 'integer');
  const hasLegacyArrayMaximum = types.length === 1 && types[0] === 'array' && max !== undefined;
  if ((min !== undefined || max !== undefined) && !hasNumericType && !hasLegacyArrayMaximum) unsupported(path, 'minimum/maximum');

  let result = zodUnion(schemas);
  if (value.nullable === true && !types.includes('null')) result = result.nullable();
  if (enumValues !== undefined) {
    const values = enumValues as readonly unknown[];
    result = result.refine((entry) => values.some((candidate) => Object.is(candidate, entry)), { message: 'Value is not in enum' });
  }
  return result;
}

function isPromptPromptsAnyOf(value: unknown): value is JsonSchema[] {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const requiredSets = value.map((branch) => isRecord(branch) && Object.keys(branch).every((key) => key === 'required')
    && Array.isArray(branch.required) ? branch.required : null);
  return requiredSets.every(Array.isArray)
    && requiredSets.some((required) => required.length === 1 && required[0] === 'prompt')
    && requiredSets.some((required) => required.length === 1 && required[0] === 'prompts');
}

export function createSdkToolSchema(parameters: Record<string, unknown>): SupportedResult | UnsupportedResult {
  try {
    if (!isRecord(parameters)) unsupported('parameters', 'type');
    assertKnownKeys(parameters, 'parameters', COMMON_KEYS);
    if (parameters.type !== 'object') unsupported('parameters', 'type');

    const anyOf = parameters.anyOf;
    if (anyOf !== undefined && !isPromptPromptsAnyOf(anyOf)) unsupported('parameters', 'anyOf');

    const objectInput = isPromptPromptsAnyOf(anyOf)
      ? Object.fromEntries(Object.entries(parameters).filter(([key]) => key !== 'anyOf'))
      : parameters;
    let validator = objectSchema(objectInput, 'parameters');
    if (isPromptPromptsAnyOf(anyOf)) {
      const properties = parameters.properties;
      if (!isRecord(properties) || !('prompt' in properties) || !('prompts' in properties)) unsupported('parameters.anyOf', 'required property');
      validator = validator.refine((value) => Object.hasOwn(value, 'prompt') || Object.hasOwn(value, 'prompts'), {
        message: 'At least one of prompt or prompts is required',
      });
    }
    return { supported: true, shape: validator.shape, validate: (input) => validator.safeParse(input).success };
  } catch (error) {
    if (error instanceof UnsupportedSchemaError) return { supported: false, reason: error.message };
    return { supported: false, reason: error instanceof Error ? error.message : 'Invalid JSON Schema' };
  }
}
