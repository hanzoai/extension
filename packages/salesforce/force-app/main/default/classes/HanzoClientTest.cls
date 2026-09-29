/**
 * HanzoClientTest — the pure request/response contract + the callout shape.
 *
 * The pure methods (URLs, buildMessages, requestBody, extractContent, parseModels)
 * mirror the same tests every Hanzo integration runs (see gworkspace/tests/
 * hanzo.test.mjs) so the wire format stays identical across the platform. The
 * callout tests use HanzoCalloutMock to assert the request goes to
 * /v1/chat/completions with the right body and to parse the response.
 */
@IsTest
private class HanzoClientTest {
    // ── Endpoints — api.hanzo.ai/v1 only, never /api/, never v2 ────────────
    @IsTest
    static void endpointsGoThroughV1() {
        System.assertEquals(
            'callout:Hanzo_API/v1/chat/completions',
            HanzoClient.chatCompletionsUrl()
        );
        System.assertEquals('callout:Hanzo_API/v1/models', HanzoClient.modelsUrl());
        System.assert(!HanzoClient.chatCompletionsUrl().contains('/api/'), 'no /api/ prefix');
        System.assert(!HanzoClient.chatCompletionsUrl().contains('/v2/'), 'no v2');
    }

    // ── buildMessages ──────────────────────────────────────────────────────
    @IsTest
    static void buildMessagesPlainWhenNoContext() {
        List<HanzoClient.Message> m = HanzoClient.buildMessages('draft a follow-up', '');
        System.assertEquals('system', m[0].role);
        System.assertEquals('user', m[1].role);
        System.assertEquals('draft a follow-up', m[1].content);
    }

    @IsTest
    static void buildMessagesFencesContextAsData() {
        List<HanzoClient.Message> m = HanzoClient.buildMessages(
            'summarize', 'Account: Acme\nIndustry: Software'
        );
        System.assert(m[1].content.contains('summarize'));
        System.assert(m[1].content.contains('---- record context ----'));
        System.assert(m[1].content.contains('Acme'));
    }

    @IsTest
    static void buildMessagesTreatsBlankContextAsPlain() {
        System.assertEquals('x', HanzoClient.buildMessages('x', null)[1].content);
        System.assertEquals('x', HanzoClient.buildMessages('x', '   ')[1].content);
    }

    @IsTest
    static void systemPromptGroundsAndForbidsFences() {
        String sys = HanzoClient.buildMessages('x', '').get(0).content.toLowerCase();
        System.assert(sys.contains('do not invent'), 'system prompt grounds the model');
        System.assert(sys.contains('no markdown fences'), 'system prompt forbids fences');
    }

    // ── requestBody ─────────────────────────────────────────────────────────
    @IsTest
    static void requestBodyDefaultsModelAndForcesNoStream() {
        Map<String, Object> b = HanzoClient.requestBody(
            HanzoClient.buildMessages('x', ''), null
        );
        System.assertEquals(HanzoClient.DEFAULT_MODEL, b.get('model'));
        System.assertEquals('zen5', HanzoClient.DEFAULT_MODEL);
        System.assertEquals(false, b.get('stream'));
        System.assert(b.get('messages') instanceof List<HanzoClient.Message>);
        System.assert(!b.containsKey('temperature'), 'temperature omitted when unset');
    }

    @IsTest
    static void requestBodyPassesModelAndTemperature() {
        HanzoClient.Options o = new HanzoClient.Options('zen5-pro');
        o.temperature = 0.2;
        Map<String, Object> b = HanzoClient.requestBody(
            HanzoClient.buildMessages('x', ''), o
        );
        System.assertEquals('zen5-pro', b.get('model'));
        System.assertEquals(0.2, b.get('temperature'));
    }

    // ── extractContent ──────────────────────────────────────────────────────
    @IsTest
    static void extractContentReadsChoicesMessageContent() {
        Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(
            HanzoCalloutMock.completion('hello')
        );
        System.assertEquals('hello', HanzoClient.extractContent(data));
    }

    @IsTest
    static void extractContentToleratesTextAndBareContent() {
        Map<String, Object> textShape = new Map<String, Object>{
            'choices' => new List<Object>{ new Map<String, Object>{ 'text' => 'a' } }
        };
        System.assertEquals('a', HanzoClient.extractContent(textShape));
        System.assertEquals(
            'b',
            HanzoClient.extractContent(new Map<String, Object>{ 'content' => 'b' })
        );
    }

    @IsTest
    static void extractContentThrowsOnErrorPayload() {
        Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(
            HanzoCalloutMock.errorBody('rate limited')
        );
        try {
            HanzoClient.extractContent(data);
            System.assert(false, 'should have thrown');
        } catch (HanzoClient.HanzoException e) {
            System.assert(e.getMessage().contains('rate limited'), e.getMessage());
        }
    }

    @IsTest
    static void extractContentThrowsWhenEmpty() {
        try {
            HanzoClient.extractContent(new Map<String, Object>{
                'choices' => new List<Object>{ new Map<String, Object>() }
            });
            System.assert(false, 'should have thrown');
        } catch (HanzoClient.HanzoException e) {
            System.assert(e.getMessage().contains('no content'), e.getMessage());
        }
    }

    // ── parseModels ──────────────────────────────────────────────────────────
    @IsTest
    static void parseModelsReadsDataIds() {
        Object data = JSON.deserializeUntyped(
            HanzoCalloutMock.modelsList(new List<String>{ 'zen5', 'zen5-pro' })
        );
        List<HanzoClient.ModelInfo> models = HanzoClient.parseModels(data);
        System.assertEquals(2, models.size());
        System.assertEquals('zen5', models[0].id);
        System.assertEquals('hanzo', models[0].ownedBy);
    }

    @IsTest
    static void parseModelsToleratesModelsKeyAndBareArrayAndDropsBlanks() {
        Object modelsKey = JSON.deserializeUntyped(
            '{"models":[{"id":"a"},{"id":""},{}]}'
        );
        System.assertEquals(1, HanzoClient.parseModels(modelsKey).size());
        Object bare = JSON.deserializeUntyped('["x","y"]');
        System.assertEquals(2, HanzoClient.parseModels(bare).size());
        System.assertEquals(0, HanzoClient.parseModels(JSON.deserializeUntyped('{}')).size());
    }

    // ── ask — the full callout, asserting the request shape ────────────────
    @IsTest
    static void askSendsCorrectRequestAndParsesResponse() {
        HanzoCalloutMock mock = new HanzoCalloutMock(200, HanzoCalloutMock.completion('Answer.'));
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        String out = HanzoClient.ask('summarize', 'Account: Acme', new HanzoClient.Options('zen5-pro'));
        Test.stopTest();

        System.assertEquals('Answer.', out);
        // URL: the Named-Credential callout, /v1/chat/completions, no /api/.
        System.assert(mock.requestEndpoint.endsWith('/v1/chat/completions'), mock.requestEndpoint);
        System.assert(!mock.requestEndpoint.contains('/api/'), 'no /api/ prefix');
        System.assertEquals('POST', mock.requestMethod);
        // Body: model + messages[], stream:false.
        System.assertEquals('zen5-pro', mock.requestBodyMap.get('model'));
        System.assertEquals(false, mock.requestBodyMap.get('stream'));
        List<Object> messages = (List<Object>) mock.requestBodyMap.get('messages');
        System.assertEquals(2, messages.size());
        Map<String, Object> userMsg = (Map<String, Object>) messages[1];
        System.assertEquals('user', userMsg.get('role'));
        System.assert(((String) userMsg.get('content')).contains('Acme'), 'context in body');
    }

    @IsTest
    static void askDefaultsModelWhenBlank() {
        HanzoCalloutMock mock = new HanzoCalloutMock(200, HanzoCalloutMock.completion('ok'));
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        HanzoClient.ask('hi', '', new HanzoClient.Options(''));
        Test.stopTest();
        System.assertEquals(HanzoClient.DEFAULT_MODEL, mock.requestBodyMap.get('model'));
    }

    @IsTest
    static void askSurfacesGatewayErrorOnNon2xx() {
        HanzoCalloutMock mock = new HanzoCalloutMock(429, HanzoCalloutMock.errorBody('slow down'));
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        try {
            HanzoClient.ask('hi', '', null);
            System.assert(false, 'should have thrown');
        } catch (HanzoClient.HanzoException e) {
            System.assert(e.getMessage().contains('429'), e.getMessage());
            System.assert(e.getMessage().contains('slow down'), e.getMessage());
        }
        Test.stopTest();
    }

    @IsTest
    static void askThrowsOnUnparseableBody() {
        HanzoCalloutMock mock = new HanzoCalloutMock(200, 'not json');
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        try {
            HanzoClient.ask('hi', '', null);
            System.assert(false, 'should have thrown');
        } catch (HanzoClient.HanzoException e) {
            System.assert(e.getMessage().contains('200'), e.getMessage());
        }
        Test.stopTest();
    }

    // ── listModels — GET /v1/models, non-fatal ─────────────────────────────
    @IsTest
    static void listModelsReturnsIdsOn200() {
        HanzoCalloutMock mock = new HanzoCalloutMock(
            200, HanzoCalloutMock.modelsList(new List<String>{ 'zen5', 'zen5-coder' })
        );
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        List<HanzoClient.ModelInfo> models = HanzoClient.listModels();
        Test.stopTest();
        System.assertEquals(2, models.size());
        System.assert(mock.requestEndpoint.endsWith('/v1/models'), mock.requestEndpoint);
        System.assertEquals('GET', mock.requestMethod);
    }

    @IsTest
    static void listModelsReturnsEmptyOnFailure() {
        HanzoCalloutMock mock = new HanzoCalloutMock(500, HanzoCalloutMock.errorBody('down'));
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        List<HanzoClient.ModelInfo> models = HanzoClient.listModels();
        Test.stopTest();
        System.assertEquals(0, models.size());
    }
}
