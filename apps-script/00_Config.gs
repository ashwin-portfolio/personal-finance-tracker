/**
 * 00_Config.gs — tab names, expected headers, and hard-coded fallbacks.
 *
 * Everything tunable at runtime lives in the Settings tab (see 02_Settings.gs).
 * This file holds only structural facts about the workbook.
 *
 * !! RECONCILE BEFORE FIRST RUN !!
 * The header lists below were written without sight of finance_tracker.xlsx.
 * Run verifySchema() (01_Schema.gs) as the very first thing you do after
 * binding this script. It reports every mismatch between these lists and the
 * real header rows, and nothing else in the pipeline will run until it passes.
 */

var TAB = {
  TRANSACTIONS: 'Transactions',
  ACCOUNTS:     'Accounts',
  SETTINGS:     'Settings',
  CATEGORIES:   'Categories',
  REVIEW_QUEUE: 'Review Queue',
  AUDIT_LOG:    'Audit Log',
  SYNC_LOGS:    'Sync Logs',
  BUDGET:       'Budget',
  DASHBOARD:    'Dashboard'
};

/** Header row index (1-based) for each tab. Adjust if a tab has a title band. */
var HEADER_ROW = {
  'Transactions': 1,
  'Accounts':     1,
  'Settings':     1,
  'Categories':   1,
  'Review Queue': 1,
  'Audit Log':    1,
  'Sync Logs':    1,
  'Budget':       1
};

/**
 * Columns the code reads or writes, per tab.
 * required:true  -> verifySchema() fails if absent; pipeline refuses to run.
 * required:false -> written when present, silently skipped when absent.
 */
var SCHEMA = {
  'Transactions': [
    { name: 'Transaction ID',        required: true  },
    { name: 'Date',                  required: true  },
    { name: 'Time',                  required: false },
    { name: 'Account',               required: true  },
    { name: 'Bank',                  required: false },
    { name: 'Transaction Type',      required: true  },
    { name: 'Amount',                required: true  },
    { name: 'Currency',              required: false },
    { name: 'Merchant',              required: true  },
    { name: 'Category',              required: true  },
    { name: 'Subcategory',           required: false },
    { name: 'Description',           required: false },
    { name: 'Reference Number',      required: false },
    { name: 'Source Email ID',       required: true  },
    { name: 'Status',                required: true  },
    { name: 'Notes',                 required: false },
    { name: 'Raw Text',              required: false },
    { name: 'Imported At',           required: false },
    { name: 'Last Modified',         required: false },
    { name: 'Excluded From Spending',required: false }
  ],
  'Review Queue': [
    { name: 'Review ID',        required: false },
    { name: 'Date',             required: false },
    { name: 'Account',          required: false },
    { name: 'Amount',           required: false },
    { name: 'Merchant',         required: false },
    { name: 'Review Reason',    required: true  },
    { name: 'Source Email ID',  required: true  },
    { name: 'Raw Text',         required: false },
    { name: 'Detail',           required: false },
    { name: 'Status',           required: false },
    { name: 'Created At',       required: false }
  ],
  'Sync Logs': [
    { name: 'Run ID',            required: false },
    { name: 'Started At',        required: true  },
    { name: 'Finished At',       required: false },
    { name: 'Trigger Type',      required: false },
    { name: 'Emails Scanned',    required: false },
    { name: 'Imported',          required: false },
    { name: 'Duplicates Skipped',required: false },
    { name: 'Sent To Review',    required: false },
    { name: 'Parsing Errors',    required: false },
    { name: 'Status',            required: true  },
    { name: 'Error Message',     required: false }
  ],
  'Accounts': [
    { name: 'Account ID',       required: true  },
    { name: 'Bank',             required: false },
    { name: 'Account Type',     required: false },
    { name: 'Sender Rule',      required: true  },
    { name: 'Last 4 Digits',    required: false },
    { name: 'Parser',           required: false },
    { name: 'Active',           required: false }
  ],
  'Categories': [
    { name: 'Keyword',     required: true  },
    { name: 'Category',    required: true  },
    { name: 'Subcategory', required: false }
  ],
  'Audit Log': [
    { name: 'Timestamp',      required: true  },
    { name: 'Transaction ID', required: true  },
    { name: 'Field',          required: true  },
    { name: 'Old Value',      required: true  },
    { name: 'New Value',      required: true  },
    { name: 'Changed By',     required: false },
    { name: 'Note',           required: false }
  ]
};

/** Settings keys this code reads, with defaults used when the key is absent. */
var SETTING_DEFAULTS = {
  'Gmail Label':                    'BankAlerts',
  'Processing Interval':            15,
  'Duplicate Review Window (days)': 3,
  'Default Category':               'Uncategorised',
  'Automation Enabled':             false,
  'Duplicate Handling':             'flag-and-insert',
  'Lookback Overlap (days)':        2,
  'Max Messages Per Run':           100,
  'Base Currency':                  'INR',
  'Refund Match Window (days)':     45,
  'Self Transfer VPAs':             '',
  'Flag Uncategorised For Review':  false
};

/** Review Queue reason vocabulary — must match the tab's data validation list. */
var REVIEW_REASON = {
  UNPARSED:          'Unparsed',
  POSSIBLE_DUP:      'Possible Duplicate',
  AMBIGUOUS_CAT:     'Ambiguous Category',
  UNSUPPORTED:       'Unsupported Bank/Format',
  AMBIGUOUS_TYPE:    'Ambiguous Transaction Type'
};

/** Transaction Type vocabulary — must match the Transactions tab validation list. */
var TXN_TYPE = {
  DEBIT:         'Debit',
  CREDIT:        'Credit',
  REFUND:        'Refund',
  CC_PAYMENT:    'CC Payment',
  SELF_TRANSFER: 'Self-Transfer'
};

var TXN_STATUS = {
  ACTIVE:       'Active',
  NEEDS_REVIEW: 'Needs Review'
};

/** Script Property keys. */
var PROP = {
  LAST_RUN_EPOCH: 'ft_last_run_epoch',
  SCHEMA_OK:      'ft_schema_verified_at'
};
