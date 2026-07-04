/**
 * HanzoContext — assembles a compact, plain-text context block for a record so
 * the model has grounded facts to work from. One method per supported object
 * (Account, Opportunity, Case, Lead, Contact) selecting the record + the key
 * related list, formatted as `Label: value` lines the model can read directly.
 *
 * Field access is enforced with `WITH SECURITY_ENFORCED` so the running user's
 * FLS/CRUD is honored — the assistant never surfaces fields the user can't see.
 * The output is truncated to a token-safe budget (truncate) so a large record
 * with hundreds of related rows can't blow the prompt or the callout body.
 */
public with sharing class HanzoContext {
    /**
     * Character budget for the assembled context. ~4 chars/token, so ~12k chars
     * keeps the record context well under a few thousand tokens, leaving room for
     * the system prompt, the user task, and the completion.
     */
    public static final Integer MAX_CONTEXT_CHARS = 12000;

    /** Supported record prefixes → builder. Keyed by the 3-char SObject key prefix. */
    private static final Map<String, String> PREFIX_TO_TYPE = new Map<String, String>{
        Account.SObjectType.getDescribe().getKeyPrefix() => 'Account',
        Opportunity.SObjectType.getDescribe().getKeyPrefix() => 'Opportunity',
        Case.SObjectType.getDescribe().getKeyPrefix() => 'Case',
        Lead.SObjectType.getDescribe().getKeyPrefix() => 'Lead',
        Contact.SObjectType.getDescribe().getKeyPrefix() => 'Contact'
    };

    /**
     * build routes a record id to the right assembler and returns the plain-text
     * context, truncated to MAX_CONTEXT_CHARS. Throws for an unsupported object so
     * the LWC only offers the assistant on the record pages it supports.
     */
    public static String build(Id recordId) {
        if (recordId == null) {
            throw new HanzoClient.HanzoException('No record in context');
        }
        String prefix = String.valueOf(recordId).substring(0, 3);
        String type = PREFIX_TO_TYPE.get(prefix);
        if (type == null) {
            throw new HanzoClient.HanzoException(
                'Hanzo Assistant does not support this object type'
            );
        }
        String raw;
        if (type == 'Account') {
            raw = account(recordId);
        } else if (type == 'Opportunity') {
            raw = opportunity(recordId);
        } else if (type == 'Case') {
            raw = caseRecord(recordId);
        } else if (type == 'Lead') {
            raw = lead(recordId);
        } else {
            raw = contact(recordId);
        }
        return truncate(raw, MAX_CONTEXT_CHARS);
    }

    /**
     * truncate keeps the head of a context block within a character budget,
     * appending a marker so the model knows content was elided. Pure — the same
     * logic is mirrored in src/context.js and unit-tested under vitest.
     */
    public static String truncate(String text, Integer maxChars) {
        if (text == null) {
            return '';
        }
        if (text.length() <= maxChars) {
            return text;
        }
        String marker = '\n… [truncated]';
        Integer keep = maxChars - marker.length();
        if (keep < 0) {
            keep = 0;
        }
        return text.substring(0, keep) + marker;
    }

    // ── Per-object assemblers ──────────────────────────────────────────────

    private static String account(Id recordId) {
        Account a = [
            SELECT Id, Name, Industry, Type, AnnualRevenue, NumberOfEmployees,
                   Phone, Website, BillingCity, BillingState, BillingCountry,
                   Description, OwnerId, Owner.Name
            FROM Account
            WHERE Id = :recordId
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        List<String> lines = new List<String>{ 'Account: ' + a.Name };
        add(lines, 'Industry', a.Industry);
        add(lines, 'Type', a.Type);
        add(lines, 'Annual Revenue', a.AnnualRevenue);
        add(lines, 'Employees', a.NumberOfEmployees);
        add(lines, 'Phone', a.Phone);
        add(lines, 'Website', a.Website);
        add(lines, 'Location', location(a.BillingCity, a.BillingState, a.BillingCountry));
        add(lines, 'Owner', a.Owner != null ? a.Owner.Name : null);
        add(lines, 'Description', a.Description);

        List<Opportunity> opps = [
            SELECT Name, StageName, Amount, CloseDate
            FROM Opportunity
            WHERE AccountId = :recordId
            WITH SECURITY_ENFORCED
            ORDER BY CloseDate DESC
            LIMIT 10
        ];
        if (!opps.isEmpty()) {
            lines.add('\nOpen & recent opportunities:');
            for (Opportunity o : opps) {
                lines.add(
                    '- ' + o.Name + ' | ' + o.StageName + ' | ' +
                    money(o.Amount) + ' | close ' + dateStr(o.CloseDate)
                );
            }
        }

        List<Contact> contacts = [
            SELECT Name, Title, Email, Phone
            FROM Contact
            WHERE AccountId = :recordId
            WITH SECURITY_ENFORCED
            ORDER BY LastModifiedDate DESC
            LIMIT 10
        ];
        if (!contacts.isEmpty()) {
            lines.add('\nContacts:');
            for (Contact c : contacts) {
                lines.add('- ' + c.Name + (c.Title != null ? ' (' + c.Title + ')' : '') +
                    (c.Email != null ? ' <' + c.Email + '>' : ''));
            }
        }
        return String.join(lines, '\n');
    }

    private static String opportunity(Id recordId) {
        Opportunity o = [
            SELECT Id, Name, StageName, Amount, CloseDate, Probability, Type,
                   LeadSource, NextStep, Description, Account.Name, Owner.Name,
                   ForecastCategoryName
            FROM Opportunity
            WHERE Id = :recordId
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        List<String> lines = new List<String>{ 'Opportunity: ' + o.Name };
        add(lines, 'Account', o.Account != null ? o.Account.Name : null);
        add(lines, 'Stage', o.StageName);
        add(lines, 'Amount', money(o.Amount));
        add(lines, 'Close Date', dateStr(o.CloseDate));
        add(lines, 'Probability', o.Probability != null ? o.Probability + '%' : null);
        add(lines, 'Forecast', o.ForecastCategoryName);
        add(lines, 'Type', o.Type);
        add(lines, 'Lead Source', o.LeadSource);
        add(lines, 'Next Step', o.NextStep);
        add(lines, 'Owner', o.Owner != null ? o.Owner.Name : null);
        add(lines, 'Description', o.Description);

        List<Task> tasks = recentTasks(recordId);
        appendTasks(lines, tasks);
        return String.join(lines, '\n');
    }

    private static String caseRecord(Id recordId) {
        Case c = [
            SELECT Id, CaseNumber, Subject, Status, Priority, Origin, Type, Reason,
                   Description, Account.Name, Contact.Name, Owner.Name
            FROM Case
            WHERE Id = :recordId
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        List<String> lines = new List<String>{ 'Case: ' + c.CaseNumber };
        add(lines, 'Subject', c.Subject);
        add(lines, 'Status', c.Status);
        add(lines, 'Priority', c.Priority);
        add(lines, 'Origin', c.Origin);
        add(lines, 'Type', c.Type);
        add(lines, 'Reason', c.Reason);
        add(lines, 'Account', c.Account != null ? c.Account.Name : null);
        add(lines, 'Contact', c.Contact != null ? c.Contact.Name : null);
        add(lines, 'Owner', c.Owner != null ? c.Owner.Name : null);
        add(lines, 'Description', c.Description);

        List<CaseComment> comments = [
            SELECT CommentBody, CreatedDate
            FROM CaseComment
            WHERE ParentId = :recordId
            WITH SECURITY_ENFORCED
            ORDER BY CreatedDate DESC
            LIMIT 10
        ];
        if (!comments.isEmpty()) {
            lines.add('\nRecent comments:');
            for (CaseComment cc : comments) {
                lines.add('- ' + cc.CommentBody);
            }
        }
        return String.join(lines, '\n');
    }

    private static String lead(Id recordId) {
        Lead l = [
            SELECT Id, Name, Company, Title, Status, Rating, LeadSource, Industry,
                   Email, Phone, City, State, Country, Description, Owner.Name
            FROM Lead
            WHERE Id = :recordId
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        List<String> lines = new List<String>{ 'Lead: ' + l.Name };
        add(lines, 'Company', l.Company);
        add(lines, 'Title', l.Title);
        add(lines, 'Status', l.Status);
        add(lines, 'Rating', l.Rating);
        add(lines, 'Lead Source', l.LeadSource);
        add(lines, 'Industry', l.Industry);
        add(lines, 'Email', l.Email);
        add(lines, 'Phone', l.Phone);
        add(lines, 'Location', location(l.City, l.State, l.Country));
        add(lines, 'Owner', l.Owner != null ? l.Owner.Name : null);
        add(lines, 'Description', l.Description);
        return String.join(lines, '\n');
    }

    private static String contact(Id recordId) {
        Contact c = [
            SELECT Id, Name, Title, Department, Email, Phone, MobilePhone,
                   MailingCity, MailingState, MailingCountry, Description,
                   Account.Name, Owner.Name
            FROM Contact
            WHERE Id = :recordId
            WITH SECURITY_ENFORCED
            LIMIT 1
        ];
        List<String> lines = new List<String>{ 'Contact: ' + c.Name };
        add(lines, 'Title', c.Title);
        add(lines, 'Department', c.Department);
        add(lines, 'Account', c.Account != null ? c.Account.Name : null);
        add(lines, 'Email', c.Email);
        add(lines, 'Phone', c.Phone);
        add(lines, 'Mobile', c.MobilePhone);
        add(lines, 'Location', location(c.MailingCity, c.MailingState, c.MailingCountry));
        add(lines, 'Owner', c.Owner != null ? c.Owner.Name : null);
        add(lines, 'Description', c.Description);

        List<Task> tasks = recentTasks(recordId);
        appendTasks(lines, tasks);
        return String.join(lines, '\n');
    }

    // ── Shared helpers ─────────────────────────────────────────────────────

    /** Recent activity (Tasks) related to a record, most recent first. */
    private static List<Task> recentTasks(Id whatOrWhoId) {
        return [
            SELECT Subject, Status, ActivityDate, Description
            FROM Task
            WHERE WhatId = :whatOrWhoId OR WhoId = :whatOrWhoId
            WITH SECURITY_ENFORCED
            ORDER BY CreatedDate DESC
            LIMIT 10
        ];
    }

    private static void appendTasks(List<String> lines, List<Task> tasks) {
        if (tasks == null || tasks.isEmpty()) {
            return;
        }
        lines.add('\nRecent activity:');
        for (Task t : tasks) {
            lines.add('- ' + t.Subject + ' (' + t.Status + ', ' +
                dateStr(t.ActivityDate) + ')');
        }
    }

    /** Append `Label: value` when value is non-blank. */
    private static void add(List<String> lines, String label, Object value) {
        if (value == null) {
            return;
        }
        String s = String.valueOf(value);
        if (!String.isBlank(s)) {
            lines.add(label + ': ' + s);
        }
    }

    private static String location(String city, String state, String country) {
        List<String> parts = new List<String>();
        if (!String.isBlank(city)) {
            parts.add(city);
        }
        if (!String.isBlank(state)) {
            parts.add(state);
        }
        if (!String.isBlank(country)) {
            parts.add(country);
        }
        return parts.isEmpty() ? null : String.join(parts, ', ');
    }

    private static String money(Decimal amount) {
        return amount == null ? 'no amount' : '$' + amount.format();
    }

    private static String dateStr(Date d) {
        return d == null ? 'n/a' : d.format();
    }
}
