/**
 * HanzoCalloutMock — a configurable HttpCalloutMock for the api.hanzo.ai gateway.
 *
 * Captures the request (URL, method, body) so tests can assert the exact wire
 * shape, and returns a canned status + body. Used by HanzoClientTest and
 * HanzoControllerTest — one mock, one place, reused (DRY).
 */
@IsTest
public class HanzoCalloutMock implements HttpCalloutMock {
    public Integer statusCode;
    public String responseBody;

    // Captured from the last request — asserted by the tests.
    public String requestEndpoint;
    public String requestMethod;
    public String requestBody;
    public String requestAuthHeader;
    public Map<String, Object> requestBodyMap;

    public HanzoCalloutMock(Integer statusCode, String responseBody) {
        this.statusCode = statusCode;
        this.responseBody = responseBody;
    }

    public HTTPResponse respond(HTTPRequest req) {
        this.requestEndpoint = req.getEndpoint();
        this.requestMethod = req.getMethod();
        this.requestBody = req.getBody();
        this.requestAuthHeader = req.getHeader('Authorization');
        if (!String.isBlank(this.requestBody)) {
            Object parsed = JSON.deserializeUntyped(this.requestBody);
            if (parsed instanceof Map<String, Object>) {
                this.requestBodyMap = (Map<String, Object>) parsed;
            }
        }
        HttpResponse res = new HttpResponse();
        res.setStatusCode(this.statusCode);
        res.setHeader('Content-Type', 'application/json');
        if (this.responseBody != null) {
            res.setBody(this.responseBody);
        }
        return res;
    }

    /** A standard OpenAI-compatible completion body with the given content. */
    public static String completion(String content) {
        return JSON.serialize(new Map<String, Object>{
            'choices' => new List<Object>{
                new Map<String, Object>{
                    'message' => new Map<String, Object>{
                        'role' => 'assistant',
                        'content' => content
                    }
                }
            }
        });
    }

    /** A /v1/models list body with the given ids. */
    public static String modelsList(List<String> ids) {
        List<Object> data = new List<Object>();
        for (String id : ids) {
            data.add(new Map<String, Object>{ 'id' => id, 'owned_by' => 'hanzo' });
        }
        return JSON.serialize(new Map<String, Object>{ 'data' => data });
    }

    /** An error body the gateway returns on failure. */
    public static String errorBody(String message) {
        return JSON.serialize(new Map<String, Object>{
            'error' => new Map<String, Object>{ 'message' => message }
        });
    }
}
