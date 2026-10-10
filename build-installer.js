// Embedded installers can accidentally publish environment secrets.
console.error('Embedded installer generation is retired. Follow ADMIN_SECURITY_RUNBOOK.md.');
process.exitCode = 1;
