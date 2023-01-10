import {
  click,
  currentRouteName,
  currentURL,
  fillIn,
} from '@ember/test-helpers';
import { assign } from '@ember/polyfills';
import { module, test } from 'qunit';
import { setupApplicationTest } from 'ember-qunit';
import { setupMirage } from 'ember-cli-mirage/test-support';
import a11yAudit from 'nomad-ui/tests/helpers/a11y-audit';
import setupCodeMirror from 'nomad-ui/tests/helpers/codemirror';
import JobRun from 'nomad-ui/tests/pages/jobs/run';

const newJobName = 'new-job';
const newJobTaskGroupName = 'redis';
const newJobNamespace = 'default';

let managementToken, clientToken;

const jsonJob = (overrides) => {
  return JSON.stringify(
    assign(
      {},
      {
        Name: newJobName,
        Namespace: newJobNamespace,
        Datacenters: ['dc1'],
        Priority: 50,
        TaskGroups: [
          {
            Name: newJobTaskGroupName,
            Tasks: [
              {
                Name: 'redis',
                Driver: 'docker',
              },
            ],
          },
        ],
      },
      overrides
    ),
    null,
    2
  );
};

module('Acceptance | job run', function (hooks) {
  setupApplicationTest(hooks);
  setupMirage(hooks);
  setupCodeMirror(hooks);

  hooks.beforeEach(function () {
    // Required for placing allocations (a result of creating jobs)
    server.create('node');

    managementToken = server.create('token');
    clientToken = server.create('token');

    window.localStorage.nomadTokenSecret = managementToken.secretId;
  });

  test('it passes an accessibility audit', async function (assert) {
    assert.expect(1);

    await JobRun.visit();
    await a11yAudit(assert);
  });

  test('visiting /jobs/run', async function (assert) {
    await JobRun.visit();

    assert.equal(currentURL(), '/jobs/run');
    assert.equal(document.title, 'Run a job - Nomad');
  });

  test('when submitting a job, the site redirects to the new job overview page', async function (assert) {
    const spec = jsonJob();

    await JobRun.visit();

    await JobRun.editor.editor.fillIn(spec);
    await JobRun.editor.plan();
    await JobRun.editor.run();
    assert.equal(
      currentURL(),
      `/jobs/${newJobName}@${newJobNamespace}`,
      `Redirected to the job overview page for ${newJobName}`
    );
  });

  test('when submitting a job to a different namespace, the redirect to the job overview page takes namespace into account', async function (assert) {
    const newNamespace = 'second-namespace';

    server.create('namespace', { id: newNamespace });
    const spec = jsonJob({ Namespace: newNamespace });

    await JobRun.visit();

    await JobRun.editor.editor.fillIn(spec);
    await JobRun.editor.plan();
    await JobRun.editor.run();
    assert.equal(
      currentURL(),
      `/jobs/${newJobName}@${newNamespace}`,
      `Redirected to the job overview page for ${newJobName} and switched the namespace to ${newNamespace}`
    );
  });

  test('when the user doesn’t have permission to run a job, redirects to the job overview page', async function (assert) {
    window.localStorage.nomadTokenSecret = clientToken.secretId;

    await JobRun.visit();
    assert.equal(currentURL(), '/jobs');
  });

  test('when using client token user can still go to job page if they have correct permissions', async function (assert) {
    const clientTokenWithPolicy = server.create('token');
    const newNamespace = 'second-namespace';

    server.create('namespace', { id: newNamespace });
    server.create('job', {
      groupCount: 0,
      createAllocations: false,
      shallow: true,
      noActiveDeployment: true,
      namespaceId: newNamespace,
    });

    const policy = server.create('policy', {
      id: 'something',
      name: 'something',
      rulesJSON: {
        Namespaces: [
          {
            Name: newNamespace,
            Capabilities: ['scale-job', 'submit-job', 'read-job', 'list-jobs'],
          },
        ],
      },
    });

    clientTokenWithPolicy.policyIds = [policy.id];
    clientTokenWithPolicy.save();
    window.localStorage.nomadTokenSecret = clientTokenWithPolicy.secretId;

    await JobRun.visit({ namespace: newNamespace });
    assert.equal(currentURL(), `/jobs/run?namespace=${newNamespace}`);
  });

  module('job template flow', function () {
    test('allows user with the correct permissions to fill in the editor using a job template', async function (assert) {
      assert.expect(10);
      // Arrange
      await JobRun.visit();
      assert
        .dom('[data-test-choose-template]')
        .exists('A button allowing a user to select a template appears.');

      server.get('/vars', function (_server, fakeRequest) {
        assert.deepEqual(
          fakeRequest.queryParams,
          {
            prefix: 'nomad/job-templates',
            namespace: '*',
          },
          'It makes a request to the /vars endpoint with the appropriate query parameters for job templates.'
        );
        return [
          {
            ID: 'nomad/job-templates/foo',
            Namespace: 'default',
            Path: 'nomad/job-templates/foo',
          },
        ];
      });

      server.get(
        '/var/nomad%2Fjob-templates%2Ffoo',
        function (_server, fakeRequest) {
          assert.deepEqual(
            fakeRequest.queryParams,
            {
              namespace: 'default',
            },
            'Dispatches O(n+1) query to retrive items.'
          );
          return {
            ID: 'nomad/job-templates/foo',
            Namespace: 'default',
            Path: 'nomad/job-templates/foo',
            Items: {
              template: 'Hello World!',
              label: 'foo',
            },
          };
        }
      );
      // Act
      await click('[data-test-choose-template]');
      assert.equal(currentRouteName(), 'jobs.run.templates.index');

      // Assert
      assert
        .dom('[data-test-template-list]')
        .exists('A list of available job templates is rendered.');
      assert
        .dom('[data-test-apply]')
        .exists('A button to apply the selected templated is displayed.');
      assert
        .dom('[data-test-cancel]')
        .exists('A button to cancel the template selection is displayed.');

      await click('[data-test-template-card=foo]');
      await click('[data-test-apply]');

      assert.equal(
        currentURL(),
        '/jobs/run?template=nomad%2Fjob-templates%2Ffoo%40default'
      );
      assert.dom('[data-test-editor]').containsText('Hello World!');
    });

    test('a user can create their own job template', async function (assert) {
      assert.expect(8);
      // Arrange
      await JobRun.visit();
      await click('[data-test-choose-template]');

      // Assert
      assert
        .dom('[data-test-empty-templates-list-headline]')
        .exists('No templates are listed if none have been created.');

      await click('[data-test-create-inline]');
      assert.equal(currentRouteName(), 'jobs.run.templates.new');

      await fillIn('[data-test-template-name]', 'foo');
      await fillIn('[data-test-template-description]', 'foo-bar-baz');
      const codeMirror = getCodeMirrorInstance('[data-test-template-json]');
      codeMirror.setValue(jsonJob());

      server.put(
        '/var/nomad%2Fjob-templates%2Ffoo?cas=0',
        function (_server, fakeRequest) {
          assert.deepEqual(
            fakeRequest.body,
            {
              Path: 'nomad/job-templates/foo',
              CreateIndex: null,
              ModifyIndex: null,
              Namespace: 'default',
              ID: 'nomad/job-templates/foo',
              Items: { description: 'foo-bar-baz', template: jsonJob() },
            },
            'It makes a PUT request to the /vars/:varId endpoint with the appropriate request body for job templates.'
          );
          return {
            Items: { description: 'foo-bar-baz', template: jsonJob() },
            Namespace: 'default',
            Path: 'nomad/job-templates/foo',
          };
        }
      );

      server.get('/vars', function (_server, fakeRequest) {
        assert.deepEqual(
          fakeRequest.queryParams,
          {
            prefix: 'nomad/job-templates',
            namespace: '*',
          },
          'It makes a request to the /vars endpoint with the appropriate query parameters for job templates.'
        );
        return [
          {
            ID: 'nomad/job-templates/foo',
            Namespace: 'default',
            Path: 'nomad/job-templates/foo',
          },
        ];
      });

      server.get(
        '/var/nomad%2Fjob-templates%2Ffoo',
        function (_server, fakeRequest) {
          assert.deepEqual(
            fakeRequest.queryParams,
            {
              namespace: 'default',
            },
            'Dispatches O(n+1) query to retrive items.'
          );
          return {
            ID: 'nomad/job-templates/foo',
            Namespace: 'default',
            Path: 'nomad/job-templates/foo',
            Items: {
              template: 'qud',
              label: 'foo',
            },
          };
        }
      );

      await click('[data-test-save-template]');
      assert.equal(currentRouteName(), 'jobs.run.templates.index');
      assert
        .dom('[data-test-template-card=foo]')
        .exists('The newly created template appears in the list.');
    });
  });
});
