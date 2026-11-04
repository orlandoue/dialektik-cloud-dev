const reference = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const arrayOf = (items: Readonly<Record<string, unknown>>) => ({ type: 'array', items });

const errorResponse = (description: string) => ({
  description,
  content: { 'application/json': { schema: reference('PublicError') } },
});

const standardErrors = {
  '400': errorResponse('Invalid request, identifier, filter, limit, or cursor.'),
  '404': errorResponse('The public resource does not exist.'),
  '409': errorResponse('The requested analysis representation is not available.'),
  '410': {
    description: 'The identifier is historical and resolves to a tombstone.',
    content: { 'application/json': { schema: reference('PublicGoneError') } },
  },
  '429': errorResponse('The per-client public read limit was exceeded.'),
  '500': errorResponse('The request failed without exposing internal diagnostics.'),
} as const;

const pageParameters = [
  {
    name: 'cursor',
    in: 'query',
    required: false,
    description: 'Opaque keyset cursor bound to this route and its filters.',
    schema: { type: 'string', maxLength: 512 },
  },
  {
    name: 'limit',
    in: 'query',
    required: false,
    description: 'Page size. Defaults to 20 and cannot exceed 50.',
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
  },
] as const;

const personalizedParameter = { name: 'personalized', in: 'query', required: false, description: 'Use authenticated source follows for ordering and badges.', schema: { type: 'string', enum: ['1'] } } as const;

const idParameter = (name: string, description: string) => ({
  name,
  in: 'path',
  required: true,
  description,
  schema: { type: 'string', pattern: '^[0-7][0-9A-HJKMNP-TV-Z]{25}$' },
});

const cachedHeaders = {
  'Cache-Control': { schema: { type: 'string' } },
  ETag: { schema: { type: 'string' } },
  'Last-Modified': { schema: { type: 'string', format: 'http-date' } },
  'X-Request-Id': { schema: { type: 'string' } },
} as const;

const success = (schema: Readonly<Record<string, unknown>>, description: string) => ({
  description,
  headers: cachedHeaders,
  content: { 'application/json': { schema } },
});

export const PUBLIC_OPENAPI_DOCUMENT = Object.freeze({
  openapi: '3.1.0',
  info: {
    title: 'Dialektik Public Read API',
    version: '1.0.0',
    description:
      'Anonymous Event-first product reads. Internal scores, interpretations, moderation records, and provider diagnostics are absent by contract.',
  },
  servers: [{ url: '/' }],
  paths: {
    '/v1/openapi.json': {
      get: {
        operationId: 'getPublicOpenApi',
        summary: 'Read the Phase-7 OpenAPI contract.',
        security: [],
        responses: {
          '200': success({ type: 'object' }, 'The OpenAPI 3.1 document.'),
          '304': { description: 'The cached contract remains current.', headers: cachedHeaders },
          '429': standardErrors['429'],
        },
      },
    },
    '/v1/feed': {
      get: {
        operationId: 'listEventFeed',
        summary: 'List current Events, optionally prioritizing followed sources.',
        description:
          'Without personalization Events are chronological. When enabled, followed sources are prioritized while all eligible Events remain visible.',
        security: [],
        parameters: [
          {
            name: 'category',
            in: 'query',
            required: false,
            schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
          },
          {
            name: 'topic',
            in: 'query',
            required: false,
            schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,79}$' },
          },
          personalizedParameter,
          ...pageParameters,
        ],
        responses: {
          '200': success(reference('EventPage'), 'A deterministic page of Event cards.'),
          '304': { description: 'The cached page remains current.', headers: cachedHeaders },
          '400': standardErrors['400'],
          '429': standardErrors['429'],
          '500': standardErrors['500'],
        },
      },
    },
    '/v1/contradictions': {
      get: {
        operationId: 'listContradictions',
        summary: 'List human-published contradiction records chronologically.',
        description:
          'Published or requires-review ContradictionPublication records are ordered chronologically or by followed source match.',
        security: [],
        parameters: [personalizedParameter, ...pageParameters],
        responses: {
          '200': success(reference('ContradictionPage'), 'A deterministic publication page.'),
          '304': { description: 'The cached page remains current.', headers: cachedHeaders },
          '400': standardErrors['400'],
          '429': standardErrors['429'],
          '500': standardErrors['500'],
        },
      },
    },
    '/v1/events/{eventId}': {
      get: {
        operationId: 'getEvent',
        summary: 'Read a current Event.',
        security: [],
        parameters: [idParameter('eventId', 'Canonical Event ULID.'), {name:'include',in:'query',required:false,schema:{type:'string',enum:['coverage']}}, personalizedParameter],
        responses: {
          '200': success(reference('EventDetail'), 'The Event read model.'),
          '304': { description: 'The cached Event remains current.', headers: cachedHeaders },
          '400': standardErrors['400'],
          '404': standardErrors['404'],
          '410': standardErrors['410'],
          '429': standardErrors['429'],
          '500': standardErrors['500'],
        },
      },
    },
    '/v1/events/{eventId}/positions': {
      get: {
        operationId: 'listEventPositions',
        summary: 'List published Positions for an analyzed Event.',
        description:
          'One self-sufficient list response ordered only by immutable neutral_rank. ANALYSIS_PENDING returns an explicit unavailable-analysis error, never a fabricated or provisional Position.',
        security: [],
        parameters: [idParameter('eventId', 'Canonical Event ULID.')],
        responses: {
          '200': success(arrayOf(reference('PositionListItem')), 'Published Position list items.'),
          '304': {
            description: 'The cached Position list remains current.',
            headers: cachedHeaders,
          },
          '400': standardErrors['400'],
          '404': standardErrors['404'],
          '409': standardErrors['409'],
          '410': standardErrors['410'],
          '429': standardErrors['429'],
          '500': standardErrors['500'],
        },
      },
    },
    '/v1/events/{eventId}/unclustered-assertions': {
      get: {
        operationId: 'listUnclusteredAssertions',
        summary: 'Read current source-grounded Assertions while analysis is pending.',
        description:
          'Available only for ANALYSIS_PENDING and ordered by ClaimSpan capture time with stable tie-breakers.',
        security: [],
        parameters: [idParameter('eventId', 'Canonical Event ULID.')],
        responses: {
          '200': success(arrayOf(reference('PublicAssertion')), 'Current unpositioned Assertions.'),
          '304': {
            description: 'The cached Assertion list remains current.',
            headers: cachedHeaders,
          },
          '400': standardErrors['400'],
          '404': standardErrors['404'],
          '410': standardErrors['410'],
          '429': standardErrors['429'],
          '500': standardErrors['500'],
        },
      },
    },
    '/v1/events/{eventId}/relationships': {
      get: {
        operationId: 'listEventRelationships',
        summary: 'Read current published layer-1 relationships.',
        description:
          'R01b and proposed relationships are absent. Human identities, similarity, confidence, and moderation provenance are not represented.',
        security: [],
        parameters: [idParameter('eventId', 'Canonical Event ULID.')],
        responses: {
          '200': success(arrayOf(reference('Relationship')), 'Published layer-1 relationships.'),
          '304': {
            description: 'The cached Relationship list remains current.',
            headers: cachedHeaders,
          },
          '400': standardErrors['400'],
          '404': standardErrors['404'],
          '410': standardErrors['410'],
          '429': standardErrors['429'],
          '500': standardErrors['500'],
        },
      },
    },
    '/v1/positions/{positionId}': {
      get: {
        operationId: 'getPosition',
        summary: 'Read one current published Position with source provenance.',
        security: [],
        parameters: [idParameter('positionId', 'Canonical Position ULID.')],
        responses: {
          '200': success(reference('PositionDetail'), 'The expanded Position read model.'),
          '304': { description: 'The cached Position remains current.', headers: cachedHeaders },
          '400': standardErrors['400'],
          '404': standardErrors['404'],
          '410': standardErrors['410'],
          '429': standardErrors['429'],
          '500': standardErrors['500'],
        },
      },
    },
    '/v1/feed/blindspots': {
      get: { operationId:'listBlindspots', summary:'List published multi-source events outside followed-source coverage.',
        security:[{BearerAuth:[]}], parameters:pageParameters,
        responses: { '200':success({type:'object',required:['items','next_cursor','total','followed_source_count'],properties:{items:arrayOf(reference('EventCard')),next_cursor:{type:['string','null']},total:{type:'integer'},followed_source_count:{type:'integer'}}},'Personalized blind spots.'), '400':standardErrors['400'] } },
    },
    '/v1/sources/following': {
      get: { operationId:'listFollowedSources', summary:'List the authenticated user’s followed source IDs.',
        security:[{BearerAuth:[]}], responses:{'200':success({type:'object',required:['source_ids'],properties:{source_ids:arrayOf({type:'string'})}},'Followed source IDs.')} },
    },
    '/v1/sources/{sourceId}/follow': {
      post: {operationId:'followSource',summary:'Follow an operational source.',security:[{BearerAuth:[]}],parameters:[idParameter('sourceId','Canonical Source ULID.')],responses:{'201':success({type:'object'},'Source followed.'),'404':standardErrors['404']}},
      delete: {operationId:'unfollowSource',summary:'Unfollow an operational source.',security:[{BearerAuth:[]}],parameters:[idParameter('sourceId','Canonical Source ULID.')],responses:{'200':success({type:'object'},'Source unfollowed.')}},
    },
    '/v1/sources/{sourceId}': {
      get: {
        operationId: 'getSource',
        summary: 'Read neutral Source identity metadata.',
        security: [],
        parameters: [idParameter('sourceId', 'Canonical Source ULID.')],
        responses: {
          '200': success(reference('Source'), 'The allowlisted Source read model.'),
          '304': { description: 'The cached Source remains current.', headers: cachedHeaders },
          '400': standardErrors['400'],
          '404': standardErrors['404'],
          '429': standardErrors['429'],
          '500': standardErrors['500'],
        },
      },
    },
  },
  components: {
    securitySchemes: { BearerAuth: { type:'http', scheme:'bearer', bearerFormat:'JWT' } },
    schemas: {
      PublicErrorBase: {
        type: 'object',
        required: ['statusCode', 'error', 'code', 'requestId'],
        properties: {
          statusCode: { type: 'integer', minimum: 400, maximum: 599 },
          error: { type: 'string' },
          code: {
            type: 'string',
            enum: [
              'PUBLIC_ANALYSIS_UNAVAILABLE',
              'PUBLIC_FORBIDDEN',
              'PUBLIC_GONE',
              'PUBLIC_INTERNAL_FAILURE',
              'PUBLIC_INVALID_CURSOR',
              'PUBLIC_INVALID_ID',
              'PUBLIC_INVALID_REQUEST',
              'PUBLIC_NOT_FOUND',
              'PUBLIC_RATE_LIMITED',
              'PUBLIC_UNAUTHORIZED',
            ],
          },
          requestId: { type: 'string' },
        },
      },
      PublicError: {
        unevaluatedProperties: false,
        allOf: [reference('PublicErrorBase')],
      },
      PublicGoneError: {
        unevaluatedProperties: false,
        allOf: [
          reference('PublicErrorBase'),
          {
            type: 'object',
            required: ['tombstone'],
            properties: { tombstone: reference('Tombstone') },
          },
        ],
      },
      Tombstone: {
        type: 'object',
        additionalProperties: false,
        required: ['operation', 'successors', 'occurred_at', 'reason'],
        properties: {
          operation: { type: 'string', enum: ['split', 'merge', 'absorbed', 'rectification'] },
          successors: arrayOf({
            type: 'object',
            additionalProperties: false,
            required: ['type', 'id'],
            properties: {
              type: {
                type: 'string',
                enum: ['Event', 'Position', 'ClaimSpan', 'ContradictionPublication'],
              },
              id: { type: 'string' },
              title: { type: 'string' },
            },
          }),
          occurred_at: { type: 'string', format: 'date-time' },
          reason: { type: 'string' },
        },
      },
      EventCardBase: {
        type: 'object',
        required: [
          'id',
          'title_descriptive',
          'category',
          'detected_at',
          'analysis_state',
          'source_count',
          'position_count',
        ],
        properties: {
          id: { type: 'string' },
          title_descriptive: { type: 'string' },
          category: { type: 'string' },
          detected_at: { type: 'string', format: 'date-time' },
          analysis_state: { type: 'string', enum: ['ANALYSIS_PENDING', 'PUBLISHED'] },
          source_count: { type: 'integer', minimum: 0 },
          position_count: { type: ['integer', 'null'], minimum: 1 },
          is_followed_source_match: { type: 'boolean' },
          synthesis_relation: { type: ['string', 'null'], enum: ['CONTRADICTION', 'DIFFERENT_FOCUS', 'DEVELOPING', 'TREND', null] },
        },
        examples: [
          {
            id: '01K4W4M7R0B000000000000001',
            title_descriptive: 'Banco central publica decisión de tasas',
            category: 'economia',
            detected_at: '2026-09-15T12:00:00.000Z',
            analysis_state: 'ANALYSIS_PENDING',
            source_count: 3,
            position_count: null,
          },
        ],
      },
      EventCard: {
        unevaluatedProperties: false,
        allOf: [reference('EventCardBase')],
      },
      EventPage: {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'next_cursor'],
        properties: {
          items: arrayOf(reference('EventCard')),
          next_cursor: { type: ['string', 'null'] },
        },
      },
      PrimaryFact: {
        type: 'object',
        additionalProperties: false,
        required: ['statement', 'primary_publication_url', 'primary_source'],
        properties: {
          statement: { type: 'string' },
          primary_publication_url: { type: 'string', format: 'uri' },
          primary_source: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'name'],
            properties: { id: { type: 'string' }, name: { type: 'string' } },
          },
        },
      },
      EventDetail: {
        unevaluatedProperties: false,
        allOf: [
          reference('EventCardBase'),
          {
            type: 'object',
            required: ['window', 'primary_fact', 'merged_into'],
            properties: {
              window: {
                type: 'object',
                additionalProperties: false,
                required: ['from', 'to'],
                properties: {
                  from: { type: 'string', format: 'date-time' },
                  to: { type: ['string', 'null'], format: 'date-time' },
                },
              },
              primary_fact: { oneOf: [reference('PrimaryFact'), { type: 'null' }] },
              merged_into: { type: 'null' },
              positions: arrayOf({type:'object'}),
              articles: arrayOf({type:'object'}),
              contrasts: arrayOf({type:'object'}),
            },
          },
        ],
      },
      PositionListItemBase: {
        type: 'object',
        required: [
          'id',
          'ordinal',
          'total',
          'neutral_rank',
          'title',
          'published_at',
          'assertion_count',
          'formed_by_count',
          'evidence_absence',
          'evidence_absence_reason',
        ],
        properties: {
          id: { type: 'string' },
          ordinal: { type: 'integer', minimum: 1 },
          total: { type: 'integer', minimum: 1 },
          neutral_rank: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          published_at: { type: 'string', format: 'date-time' },
          assertion_count: { type: 'integer', minimum: 1 },
          formed_by_count: { type: 'integer', minimum: 0, description: 'Confirmed formation relationships; zero for an individually reviewed single-claim position.' },
          evidence_absence: {
            type: ['string', 'null'],
            enum: ['no_evidence_yet', 'inconclusive', null],
          },
          evidence_absence_reason: { type: ['string', 'null'] },
        },
      },
      PositionListItem: {
        unevaluatedProperties: false,
        allOf: [reference('PositionListItemBase')],
      },
      Attribution: {
        type: 'object',
        additionalProperties: false,
        required: ['order', 'attributor', 'attributor_type'],
        properties: {
          order: { type: 'integer', minimum: 1 },
          attributor: { type: 'string' },
          attributor_type: { type: 'string' },
        },
      },
      ClaimSpan: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'quoted_text',
          'location',
          'attribution_chain',
          'article',
          'captured_at',
          'highlight_ranges',
          'rectified',
        ],
        properties: {
          id: { type: 'string' },
          quoted_text: { type: 'string' },
          location: { type: 'string', enum: ['headline', 'lede', 'body', 'caption'] },
          attribution_chain: arrayOf(reference('Attribution')),
          article: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'url_canonical', 'published_at', 'source'],
            properties: {
              id: { type: 'string' },
              url_canonical: { type: 'string', format: 'uri' },
              published_at: { type: 'string', format: 'date-time' },
              source: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'name', 'source_type'],
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  source_type: { type: 'string' },
                },
              },
            },
          },
          captured_at: { type: 'string', format: 'date-time' },
          highlight_ranges: arrayOf({
            type: 'object',
            additionalProperties: false,
            required: ['start', 'end', 'assertion_id'],
            properties: {
              start: { type: 'integer', minimum: 0 },
              end: { type: 'integer', minimum: 1 },
              assertion_id: { type: 'string' },
            },
          }),
          rectified: { type: 'null' },
        },
      },
      PublicAssertion: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'ordinal_in_span',
          'is_principal',
          'span',
          'epistemic_class',
          'epistemic_reason',
          'evidence_by_stance_for_assertion',
          'my_evaluation',
        ],
        properties: {
          id: { type: 'string' },
          ordinal_in_span: { type: 'integer', minimum: 1 },
          is_principal: { type: 'boolean' },
          span: reference('ClaimSpan'),
          epistemic_class: { type: ['string', 'null'], enum: ['not_evaluable', null] },
          epistemic_reason: { type: ['string', 'null'] },
          evidence_by_stance_for_assertion: { type: 'null' },
          my_evaluation: { type: 'null' },
        },
      },
      FormedBy: {
        type: 'object',
        additionalProperties: false,
        required: ['relationship_id', 'declared_by_display', 'declared_at'],
        properties: {
          relationship_id: { type: 'string' },
          declared_by_display: { type: 'string', const: 'equipo editorial' },
          declared_at: { type: 'string', format: 'date-time' },
        },
      },
      PositionDetail: {
        unevaluatedProperties: false,
        allOf: [
          reference('PositionListItemBase'),
          {
            type: 'object',
            required: ['source_count', 'assertions', 'formed_by'],
            properties: {
              source_count: { type: 'integer', minimum: 1 },
              assertions: arrayOf(reference('PublicAssertion')),
              formed_by: arrayOf(reference('FormedBy')),
            },
          },
        ],
      },
      Relationship: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'rel_type',
          'scope',
          'endpoints',
          'non_comparable_reason',
          'triggering_evidence_id',
          'rectified_by',
          'confirmed_at',
        ],
        properties: {
          id: { type: 'string' },
          rel_type: { type: 'string', enum: ['R01a', 'R05', 'R06', 'R07', 'R11a', 'R11b'] },
          scope: { type: 'string', enum: ['intra_event', 'cross_event', 'intra_article'] },
          endpoints: {
            type: 'array',
            minItems: 2,
            maxItems: 2,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['assertion_id', 'role'],
              properties: {
                assertion_id: { type: 'string' },
                role: { type: 'string', enum: ['peer', 'source', 'target'] },
              },
            },
          },
          non_comparable_reason: { type: ['string', 'null'] },
          triggering_evidence_id: { type: ['string', 'null'] },
          rectified_by: { type: ['string', 'null'], enum: ['SOURCE', 'MODERATION', null] },
          confirmed_at: { type: 'string', format: 'date-time' },
        },
      },
      PositionReference: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'ordinal', 'title'],
        properties: {
          id: { type: 'string' },
          ordinal: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
        },
      },
      Contradiction: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'event_id',
          'event_title',
          'position_a',
          'position_b',
          'ratio',
          'threshold_rule',
          'confirmed_at',
          'needs_review',
        ],
        properties: {
          id: { type: 'string' },
          event_id: { type: 'string' },
          event_title: { type: 'string' },
          position_a: reference('PositionReference'),
          position_b: reference('PositionReference'),
          ratio: {
            type: 'object',
            additionalProperties: false,
            required: ['conflicting', 'comparable'],
            properties: {
              conflicting: { type: 'integer', minimum: 0 },
              comparable: { type: 'integer', minimum: 1 },
            },
          },
          threshold_rule: { type: 'string' },
          confirmed_at: { type: 'string', format: 'date-time' },
          needs_review: { type: 'boolean' },
          is_followed_source_match: { type: 'boolean' },
        },
      },
      ContradictionPage: {
        type: 'object',
        additionalProperties: false,
        required: ['items', 'next_cursor'],
        properties: {
          items: arrayOf(reference('Contradiction')),
          next_cursor: { type: ['string', 'null'] },
        },
      },
      Source: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'source_type'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          source_type: { type: 'string' },
        },
      },
    },
  },
  security: [],
} as const);
