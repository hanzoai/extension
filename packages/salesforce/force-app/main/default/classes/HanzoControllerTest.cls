/**
 * HanzoControllerTest — the @AuraEnabled surface the LWC calls: complete over each
 * supported object, listModels for the picker, and writeBack creating a Task, a
 * ContentNote, and a Chatter post. Also covers HanzoContext assembly + truncate.
 *
 * complete's callout is mocked with HanzoCalloutMock; writeBack is real DML asserted
 * by querying the created record back.
 */
@IsTest
private class HanzoControllerTest {
    // Build one connected graph: Account → Opportunity, Contact, Case; plus a Lead.
    private static Account acct;
    private static Opportunity opp;
    private static Contact con;
    private static Case cse;
    private static Lead led;

    static void seed() {
        acct = new Account(
            Name = 'Acme Corp',
            Industry = 'Technology',
            AnnualRevenue = 5000000,
            NumberOfEmployees = 250,
            Description = 'Strategic account.'
        );
        insert acct;

        con = new Contact(
            FirstName = 'Dana',
            LastName = 'Rivers',
            Title = 'VP Sales',
            Email = 'dana@acme.example',
            AccountId = acct.Id
        );
        insert con;

        opp = new Opportunity(
            Name = 'Acme Platform Deal',
            StageName = 'Proposal/Price Quote',
            Amount = 120000,
            CloseDate = Date.today().addDays(30),
            AccountId = acct.Id,
            NextStep = 'Send revised quote'
        );
        insert opp;

        cse = new Case(
            Subject = 'Login failure',
            Status = 'New',
            Priority = 'High',
            AccountId = acct.Id,
            ContactId = con.Id,
            Description = 'User cannot log in after upgrade.'
        );
        insert cse;

        led = new Lead(
            FirstName = 'Sam',
            LastName = 'Nguyen',
            Company = 'Globex',
            Title = 'CTO',
            Status = 'Open - Not Contacted',
            Email = 'sam@globex.example'
        );
        insert led;

        // Related activity so the context assemblers exercise the related-list paths.
        insert new Task(
            Subject = 'Intro call',
            Status = 'Completed',
            WhatId = opp.Id,
            ActivityDate = Date.today().addDays(-2)
        );
        insert new CaseComment(ParentId = cse.Id, CommentBody = 'Escalated to tier 2.');
    }

    // ── complete — one path per supported object ───────────────────────────
    @IsTest
    static void completeSummarizesAccountWithContext() {
        seed();
        HanzoCalloutMock mock = new HanzoCalloutMock(
            200, HanzoCalloutMock.completion('Acme is a strategic tech account.')
        );
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        String out = HanzoController.complete('Summarize this record', acct.Id, 'zen5');
        Test.stopTest();

        System.assertEquals('Acme is a strategic tech account.', out);
        // The assembled Account context (name + related opp/contact) reached the body.
        List<Object> messages = (List<Object>) mock.requestBodyMap.get('messages');
        String userContent = (String) ((Map<String, Object>) messages[1]).get('content');
        System.assert(userContent.contains('Acme Corp'), 'account name in context');
        System.assert(userContent.contains('Acme Platform Deal'), 'related opp in context');
        System.assert(userContent.contains('Dana Rivers'), 'related contact in context');
    }

    @IsTest
    static void completeWorksForOpportunityCaseLeadContact() {
        seed();
        Test.setMock(
            HttpCalloutMock.class,
            new HanzoCalloutMock(200, HanzoCalloutMock.completion('ok'))
        );
        Test.startTest();
        System.assertEquals('ok', HanzoController.complete('next steps', opp.Id, 'zen5'));
        System.assertEquals('ok', HanzoController.complete('draft reply', cse.Id, 'zen5'));
        System.assertEquals('ok', HanzoController.complete('qualify', led.Id, 'zen5'));
        System.assertEquals('ok', HanzoController.complete('who is this', con.Id, 'zen5'));
        Test.stopTest();
    }

    @IsTest
    static void completeFallsBackToConfiguredDefaultModelWhenBlank() {
        seed();
        HanzoCalloutMock mock = new HanzoCalloutMock(200, HanzoCalloutMock.completion('ok'));
        Test.setMock(HttpCalloutMock.class, mock);
        Test.startTest();
        // Blank model → resolve from Hanzo_Config__mdt 'Default' (or client default).
        HanzoController.complete('summarize', acct.Id, '');
        Test.stopTest();
        System.assert(
            !String.isBlank((String) mock.requestBodyMap.get('model')),
            'a default model is applied when the caller passes blank'
        );
    }

    @IsTest
    static void completeRejectsBlankTask() {
        seed();
        try {
            HanzoController.complete('   ', acct.Id, 'zen5');
            System.assert(false, 'should have thrown');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
    }

    @IsTest
    static void completeRejectsUnsupportedObject() {
        // A User id (prefix 005) is not a supported record type.
        Id userId = UserInfo.getUserId();
        Test.setMock(
            HttpCalloutMock.class,
            new HanzoCalloutMock(200, HanzoCalloutMock.completion('x'))
        );
        try {
            HanzoController.complete('summarize', userId, 'zen5');
            System.assert(false, 'should have thrown for unsupported object');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
    }

    @IsTest
    static void completeSurfacesGatewayError() {
        seed();
        Test.setMock(
            HttpCalloutMock.class,
            new HanzoCalloutMock(401, HanzoCalloutMock.errorBody('bad key'))
        );
        Test.startTest();
        try {
            HanzoController.complete('summarize', acct.Id, 'zen5');
            System.assert(false, 'should have thrown');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        Test.stopTest();
    }

    // ── listModels ──────────────────────────────────────────────────────────
    @IsTest
    static void listModelsReturnsPickerIds() {
        Test.setMock(
            HttpCalloutMock.class,
            new HanzoCalloutMock(200, HanzoCalloutMock.modelsList(new List<String>{ 'zen5', 'zen5-pro' }))
        );
        Test.startTest();
        List<HanzoClient.ModelInfo> models = HanzoController.listModels();
        Test.stopTest();
        System.assertEquals(2, models.size());
        System.assertEquals('zen5', models[0].id);
    }

    // ── writeBack — Task / Note / Chatter ──────────────────────────────────
    @IsTest
    static void writeBackCreatesTaskOnOpportunity() {
        seed();
        Test.startTest();
        Id taskId = HanzoController.writeBack(opp.Id, 'Follow up next week.\nSecond line.', 'TASK');
        Test.stopTest();
        Task t = [SELECT Subject, Description, Status, WhatId, WhoId FROM Task WHERE Id = :taskId];
        System.assertEquals(opp.Id, t.WhatId, 'opportunity uses WhatId');
        System.assertEquals(null, t.WhoId);
        System.assertEquals('Completed', t.Status);
        System.assert(t.Subject.startsWith('Hanzo AI: '), t.Subject);
        System.assert(t.Description.contains('Second line.'), 'full text saved');
    }

    @IsTest
    static void writeBackTaskUsesWhoIdForContact() {
        seed();
        Test.startTest();
        Id taskId = HanzoController.writeBack(con.Id, 'Called Dana.', 'TASK');
        Test.stopTest();
        Task t = [SELECT WhatId, WhoId FROM Task WHERE Id = :taskId];
        System.assertEquals(con.Id, t.WhoId, 'contact uses WhoId');
        System.assertEquals(null, t.WhatId);
    }

    @IsTest
    static void writeBackCreatesNoteLinkedToRecord() {
        seed();
        Test.startTest();
        Id noteId = HanzoController.writeBack(acct.Id, 'Account summary line one.', 'NOTE');
        Test.stopTest();
        ContentNote note = [SELECT Title FROM ContentNote WHERE Id = :noteId];
        System.assert(note.Title.startsWith('Hanzo AI — '), note.Title);
        List<ContentDocumentLink> links = [
            SELECT LinkedEntityId FROM ContentDocumentLink
            WHERE ContentDocumentId = :noteId
        ];
        Boolean linked = false;
        for (ContentDocumentLink l : links) {
            if (l.LinkedEntityId == acct.Id) {
                linked = true;
            }
        }
        System.assert(linked, 'note linked to the account');
    }

    @IsTest
    static void writeBackPostsToChatter() {
        seed();
        Test.startTest();
        Id feedId = HanzoController.writeBack(acct.Id, 'AI insight for the team.', 'CHATTER');
        Test.stopTest();
        FeedItem post = [SELECT ParentId, Body FROM FeedItem WHERE Id = :feedId];
        System.assertEquals(acct.Id, post.ParentId);
        System.assertEquals('AI insight for the team.', post.Body);
    }

    @IsTest
    static void writeBackRejectsBadInputs() {
        seed();
        try {
            HanzoController.writeBack(acct.Id, '  ', 'TASK');
            System.assert(false, 'blank text should throw');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
        try {
            HanzoController.writeBack(acct.Id, 'text', 'BOGUS');
            System.assert(false, 'unknown kind should throw');
        } catch (AuraHandledException e) {
            System.assert(true);
        }
    }

    // ── HanzoContext directly: truncate + null-id guard ────────────────────
    @IsTest
    static void truncateKeepsHeadAndMarksElision() {
        String big = 'x'.repeat(HanzoContext.MAX_CONTEXT_CHARS + 500);
        String cut = HanzoContext.truncate(big, HanzoContext.MAX_CONTEXT_CHARS);
        System.assertEquals(HanzoContext.MAX_CONTEXT_CHARS, cut.length());
        System.assert(cut.endsWith('[truncated]'), 'marker appended');
    }

    @IsTest
    static void truncatePassesShortTextThrough() {
        System.assertEquals('short', HanzoContext.truncate('short', 100));
        System.assertEquals('', HanzoContext.truncate(null, 100));
    }

    @IsTest
    static void buildRejectsNullId() {
        try {
            HanzoContext.build(null);
            System.assert(false, 'null id should throw');
        } catch (HanzoClient.HanzoException e) {
            System.assert(true);
        }
    }
}
