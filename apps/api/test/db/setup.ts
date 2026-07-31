const expected = 'postgres://askesis_test:askesis_test@127.0.0.1:55432/askesis_test';
if (process.env.TEST_DATABASE_URL !== expected) {
  throw new Error('Database tests require the disposable local Askesis test database.');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = expected;
process.env.CLERK_SECRET_KEY = 'sk_test_database_tests';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_ZGF0YWJhc2UtdGVzdHMuY2xlcmsuYWNjb3VudHMuZGV2JA';
process.env.LOG_LEVEL = 'silent';
