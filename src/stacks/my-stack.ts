import { Fn, TerraformOutput, TerraformStack } from "cdktf";
import type { Construct } from "constructs";
import YAML from "yaml";
import { CodebuildProject } from "../../.gen/providers/aws/codebuild-project";
import { CodebuildSourceCredential } from "../../.gen/providers/aws/codebuild-source-credential";
import { CodebuildWebhook } from "../../.gen/providers/aws/codebuild-webhook";
import { DataAwsIamPolicyDocument } from "../../.gen/providers/aws/data-aws-iam-policy-document";
import { IamRole } from "../../.gen/providers/aws/iam-role";
import { AwsProvider } from "../../.gen/providers/aws/provider";
import { GithubProvider } from "../../.gen/providers/github/provider";
import { Repository } from "../../.gen/providers/github/repository";
import { RepositoryFile } from "../../.gen/providers/github/repository-file";
import { validateEnv } from "../utils/validate-env";

// Required environment variables
const env = validateEnv(["GITHUB_TOKEN"]);

export class MyStack extends TerraformStack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    //==============================================================================
    // PROVIDERS
    //==============================================================================

    // Configure providers
    new AwsProvider(this, "AwsProvider");
    new GithubProvider(this, "GithubProvider");

    //==============================================================================
    // GITHUB
    //==============================================================================

    const sampleRepo = new Repository(this, "SampleRepo", {
      name: "sample-repo",
      autoInit: true,
    });

    //==============================================================================
    // IAM POLICIES
    //==============================================================================

    const codebuildAssumeRolePolicy = new DataAwsIamPolicyDocument(
      this,
      "CodebuildAssumeRolePolicy",
      {
        statement: [
          {
            effect: "Allow",
            actions: ["sts:AssumeRole"],
            principals: [
              {
                type: "Service",
                identifiers: ["codebuild.amazonaws.com"],
              },
            ],
          },
        ],
      },
    );

    const cwLogsPolicy = new DataAwsIamPolicyDocument(this, "CWLogsPolicy", {
      statement: [
        {
          effect: "Allow",
          actions: ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
          resources: ["*"],
        },
      ],
    });

    //==============================================================================
    // IAM ROLES
    //==============================================================================

    const codebuildProjectRole = new IamRole(this, "CodebuildProjectRole", {
      name: "codebuild-project-role",
      assumeRolePolicy: codebuildAssumeRolePolicy.json,
      inlinePolicy: [
        {
          name: "cw-logs-policy",
          policy: cwLogsPolicy.json,
        },
      ],
    });

    //==============================================================================
    // CODEBUILD
    //==============================================================================

    new CodebuildSourceCredential(this, "GithubSourceCredential", {
      authType: "PERSONAL_ACCESS_TOKEN",
      serverType: "GITHUB",
      token: env.GITHUB_TOKEN,
    });

    const sampleProject = new CodebuildProject(this, "SampleProject", {
      name: "sample-project",
      serviceRole: codebuildProjectRole.arn,
      source: {
        type: "GITHUB",
        location: sampleRepo.htmlUrl,
      },
      environment: {
        type: "LINUX_CONTAINER",
        computeType: "BUILD_GENERAL1_SMALL",
        image: "aws/codebuild/standard:7.0",
      },
      artifacts: {
        type: "NO_ARTIFACTS",
      },
    });

    new CodebuildWebhook(this, "CodebuildWebhook", {
      projectName: sampleProject.name,
      filterGroup: [
        {
          filter: [
            {
              type: "EVENT",
              pattern: "WORKFLOW_JOB_QUEUED",
            },
          ],
        },
      ],
    });

    //==============================================================================
    // GHA WORKFLOWS
    //==============================================================================

    // GHA workflow in Object format
    const ghaWorkflowObject = {
      name: "Hello World",
      on: {
        workflow_dispatch: {},
      },
      jobs: {
        hello_world: {
          "runs-on": `codebuild-${sampleProject.name}-${Fn.rawString("${{ github.run_id }}-${{ github.run_attempt }}")}`,
          steps: [
            {
              run: 'echo "Hello World!"',
            },
          ],
        },
      },
    };

    // Add GHA workflow file to repository
    new RepositoryFile(this, "GhaWorkflowFile", {
      repository: sampleRepo.name,
      file: Fn.rawString(".github/workflows/hello-world.yml"),
      content: YAML.stringify(ghaWorkflowObject),
      commitMessage: "Add GHA workflow file",
    });

    //==============================================================================
    // OUTPUTS
    //==============================================================================

    new TerraformOutput(this, "GhaWorkflowUrl", {
      value: `https://github.com/${sampleRepo.fullName}/actions/workflows/hello-world.yml`,
      description: "URL to the GitHub Actions workflow",
    });
  }
}
