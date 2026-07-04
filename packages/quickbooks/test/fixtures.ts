// Realistic QuickBooks Online report + query fixtures for the finance / analysis
// tests. Trimmed from the shapes the Accounting API v3 actually returns (nested
// Header/Columns/Rows sections with Summary subtotals; QueryResponse wrapping an
// entity array). Kept small but structurally faithful so the renderers are
// exercised against the real tree, not a toy.

// A two-column (period-over-period) Profit and Loss with Income and Expenses
// sections, each with rows + a section Summary, and a top-level Net Income
// summary row. This is the canonical fixture the "summarize financials" flow
// runs over.
export const PROFIT_AND_LOSS = {
  Header: {
    ReportName: 'ProfitAndLoss',
    StartPeriod: '2026-01-01',
    EndPeriod: '2026-06-30',
    Currency: 'USD',
    ReportBasis: 'Accrual',
  },
  Columns: {
    Column: [
      { ColTitle: '', ColType: 'Account' },
      { ColTitle: 'Jan - Jun 2026', ColType: 'Money' },
      { ColTitle: 'Jan - Jun 2025', ColType: 'Money' },
    ],
  },
  Rows: {
    Row: [
      {
        type: 'Section',
        group: 'Income',
        Header: { ColData: [{ value: 'Income' }, { value: '' }, { value: '' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: 'Services', id: '1' }, { value: '120000.00' }, { value: '90000.00' }] },
            { type: 'Data', ColData: [{ value: 'Product Sales', id: '2' }, { value: '48000.00' }, { value: '52000.00' }] },
          ],
        },
        Summary: { ColData: [{ value: 'Total Income' }, { value: '168000.00' }, { value: '142000.00' }] },
      },
      {
        type: 'Section',
        group: 'Expenses',
        Header: { ColData: [{ value: 'Expenses' }, { value: '' }, { value: '' }] },
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: 'Payroll', id: '10' }, { value: '95000.00' }, { value: '80000.00' }] },
            { type: 'Data', ColData: [{ value: 'Rent', id: '11' }, { value: '24000.00' }, { value: '24000.00' }] },
            { type: 'Data', ColData: [{ value: 'Software', id: '12' }, { value: '12000.00' }, { value: '7000.00' }] },
          ],
        },
        Summary: { ColData: [{ value: 'Total Expenses' }, { value: '131000.00' }, { value: '111000.00' }] },
      },
      {
        type: 'Data',
        group: 'NetIncome',
        Summary: { ColData: [{ value: 'Net Income' }, { value: '37000.00' }, { value: '31000.00' }] },
      },
    ],
  },
};

// A QueryResponse wrapping three invoices — the shape `SELECT * FROM Invoice`
// returns. Used by the entity-context + panel-paste tests.
export const INVOICE_QUERY = {
  QueryResponse: {
    startPosition: 1,
    maxResults: 3,
    totalCount: 3,
    Invoice: [
      {
        Id: '101',
        DocNumber: '1001',
        TxnDate: '2026-06-01',
        DueDate: '2026-07-01',
        CustomerRef: { value: '55', name: 'Acme Co' },
        TotalAmt: 5000.0,
        Balance: 5000.0,
        CurrencyRef: { value: 'USD' },
        Line: [],
      },
      {
        Id: '102',
        DocNumber: '1002',
        TxnDate: '2026-06-05',
        DueDate: '2026-07-05',
        CustomerRef: { value: '56', name: 'Globex' },
        TotalAmt: 1200.0,
        Balance: 0.0,
        CurrencyRef: { value: 'USD' },
        Line: [],
      },
      {
        Id: '103',
        DocNumber: '1003',
        TxnDate: '2026-06-10',
        DueDate: '2026-07-10',
        CustomerRef: { value: '57', name: 'Initech' },
        TotalAmt: 8750.5,
        Balance: 8750.5,
        CurrencyRef: { value: 'USD' },
        Line: [],
      },
    ],
  },
};

// A QBO Fault error envelope — what a bad query/write returns with HTTP 400.
export const FAULT = {
  Fault: {
    Error: [
      {
        Message: 'Invalid query',
        Detail: 'QueryParserError: Encountered "FRM" at line 1, column 10.',
        code: '4000',
      },
    ],
    type: 'ValidationFault',
  },
};
