const { execSync } = require("child_process");
require('dotenv').config();

// Configuration
const REPO_OWNER = process.env.REPO_OWNER;
const REPO_NAME = process.env.REPO_NAME;
const ENVIRONMENT_NAME = process.env.ENVIRONMENT_NAME; // Change in .env file
const SOURCE_ENVIRONMENT = process.env.SOURCE_ENVIRONMENT; // Change in .env file

// Helper function to execute GitHub CLI commands
function runCommand(command) {
  try {
    console.log(`Running: ${command}`);
    const output = execSync(command, { stdio: "inherit" });
    return output;
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error.message);
    process.exit(1);
  }
}

// Get secrets from an environment
function getSecrets(envName) {
  try {
    const command = `gh secret list --repo ${REPO_OWNER}/${REPO_NAME} --env ${envName} --json name --jq ".[].name"`;
    const output = execSync(command, { encoding: "utf8" });
    return output.trim().split("\n").filter(Boolean);
  } catch (error) {
    console.error(`Error getting secrets from ${envName}:`, error.message);
    return [];
  }
}

// Get variables from an environment
function getVariables(envName) {
  try {
    const command = `gh variable list --repo ${REPO_OWNER}/${REPO_NAME} --env ${envName} --json name --jq ".[].name"`;
    const output = execSync(command, { encoding: "utf8" });
    return output.trim().split("\n").filter(Boolean);
  } catch (error) {
    console.error(`Error getting variables from ${envName}:`, error.message);
    return [];
  }
}

// Get secret value from source environment
function getSecretValue(secretName, sourceEnv) {
  try {
    // Environment-scoped secret values cannot be retrieved via CLI
    console.warn(`Warning: Cannot retrieve value for environment-scoped secret '${secretName}'. Skipping value copy.`);
    return null;
  } catch (error) {
    console.error(`Error getting secret value for ${secretName}:`, error.message);
    return null;
  }
}

// Get variable value from source environment
function getVariableValue(varName, sourceEnv) {
  try {
    // Environment-scoped variable values cannot be retrieved via CLI
    console.warn(`Warning: Cannot retrieve value for environment-scoped variable '${varName}'. Skipping value copy.`);
    return null;
  } catch (error) {
    console.error(`Error getting variable value for ${varName}:`, error.message);
    return null;
  }
}

// Sync missing secrets and variables from source to target environment
function syncMissingSecretsAndVars() {
  console.log(`Checking for missing secrets and variables in ${ENVIRONMENT_NAME}...`);

  // Get lists of secrets and variables from both environments
  const sourceSecrets = getSecrets(SOURCE_ENVIRONMENT);
  const targetSecrets = getSecrets(ENVIRONMENT_NAME);
  const sourceVars = getVariables(SOURCE_ENVIRONMENT);
  const targetVars = getVariables(ENVIRONMENT_NAME);

  // Find missing secrets
  const missingSecrets = sourceSecrets.filter((secret) => !targetSecrets.includes(secret));
  console.log(`Found ${missingSecrets.length} missing secrets`);

  missingSecrets.forEach((secretName) => {
    const value = getSecretValue(secretName, SOURCE_ENVIRONMENT);
    if (value) {
      console.log(`Adding missing secret: ${secretName}`);
      runCommand(
        `gh secret set ${secretName} --repo ${REPO_OWNER}/${REPO_NAME} --env ${ENVIRONMENT_NAME} --body "${value}"`
      );
    }
  });

  // Find secrets to delete (in target but not in source)
  const secretsToDelete = targetSecrets.filter((secret) => !sourceSecrets.includes(secret));
  secretsToDelete.forEach((secretName) => {
    console.log(`Deleting secret not in source: ${secretName}`);
    runCommand(
      `gh secret delete ${secretName} --repo ${REPO_OWNER}/${REPO_NAME} --env ${ENVIRONMENT_NAME}`
    );
  });

  // Find missing variables
  const missingVars = sourceVars.filter((variable) => !targetVars.includes(variable));
  console.log(`Found ${missingVars.length} missing variables`);

  missingVars.forEach((varName) => {
    const value = getVariableValue(varName, SOURCE_ENVIRONMENT);
    if (value) {
      console.log(`Adding missing variable: ${varName}`);
      runCommand(
        `gh variable set ${varName} --repo ${REPO_OWNER}/${REPO_NAME} --env ${ENVIRONMENT_NAME} --body "${value}"`
      );
    }
  });

  // Find variables to delete (in target but not in source)
  const varsToDelete = targetVars.filter((variable) => !sourceVars.includes(variable));
  varsToDelete.forEach((varName) => {
    console.log(`Deleting variable not in source: ${varName}`);
    runCommand(
      `gh variable delete ${varName} --repo ${REPO_OWNER}/${REPO_NAME} --env ${ENVIRONMENT_NAME}`
    );
  });
}

// Main function
function main() {
  // createEnvironment();
  syncMissingSecretsAndVars();
  // addEnvironmentVariables();
  console.log("Environment setup complete!");
}

// Run the script
main();
