/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { action, computed } from '@ember/object';
import { inject as service } from '@ember/service';
import { alias } from '@ember/object/computed';
import { tracked } from '@glimmer/tracking';
import { task } from 'ember-concurrency';
import messageFromAdapterError from 'nomad-ui/utils/message-from-adapter-error';

export default class SentinelPolicyEditorComponent extends Component {
  @service notifications;
  @service router;
  @service store;
  @tracked devMode = null;
  @tracked jobs = null;
  @tracked selectedJobspec = `job "hello-world" {
    meta {
      foo = "bar"
    }
    group "servers" {
      count = 1
  
      network {
        port "www" {
          to = 8001
        }
      }
  
      # Tasks are individual units of work that are run by Nomad.
      task "web" {
        # This particular task starts a simple web server within a Docker container
        driver = "docker"
  
        config {
          image   = "busybox:1"
          command = "httpd"
          args    = ["-v", "-f", "-p", "\${NOMAD_PORT_www}", "-h", "/local"]
          ports   = ["www"]
        }
  
        template {
          data        = <<-EOF
                        <h1>Hello, Nomad!</h1>
                        EOF
          destination = "local/index.html"
        }
  
        # Specify the maximum resources required to run the task
        resources {
          cpu    = 50
          memory = 64
        }
      }
    }
  }
  `;

  @alias('args.policy') policy;

  @action updatePolicy(value) {
    this.policy.set('policy', value);
  }

  @action updatePolicyName({ target: { value } }) {
    this.policy.set('name', value);
  }

  @action updatePolicyEnforcementLevel({ target: { id } }) {
    this.policy.set('enforcementLevel', id);
  }

  @action updatedSelectedJobspec({ target: { value } }) {
    this.selectedJobspec = value;
  }

  @action async enterDevMode() {
    let jobs = await this.store.query('job', { meta: true });
    this.jobs = jobs;
    this.devMode = true;
  }

  @action exitDevMode() {
    this.devMode = false;
  }

  @action async getJobspecOptions() {
    return this.store.peekAll('submission');
  }

  @task(function* (arg) {
    // TODO: This only works on default
    const fullId = JSON.stringify([arg, 'default']);
    let job = yield this.store.findRecord('job', fullId, { reload: true });
    console.log('job name', job.name);
    const spec = yield job.fetchRawSpecification();
    console.log('spec', spec);
    this.selectedJobspec = spec;
    yield true;
  })
  selectJob;

  @computed('jobs')
  get jobNames() {
    return this.jobs.map((j) => {
      return { key: j.name, label: j.name };
    });
  }

  @action async testIt() {
    await this.policy.testAgainstJob(this.selectedJobspec);
  }

  @action async save(e) {
    if (e instanceof Event) {
      e.preventDefault(); // code-mirror "command+enter" submits the form, but doesnt have a preventDefault()
    }
    try {
      const nameRegex = '^[a-zA-Z0-9-]{1,128}$';
      if (!this.policy.name?.match(nameRegex)) {
        throw new Error(
          `Policy name must be 1-128 characters long and can only contain letters, numbers, and dashes.`
        );
      }
      const shouldRedirectAfterSave = this.policy.isNew;
      // Because we set the ID for adapter/serialization reasons just before save here,
      // that becomes a barrier to our Unique Name validation. So we explicltly exclude
      // the current policy when checking for uniqueness.
      if (
        this.policy.isNew &&
        this.store
          .peekAll('sentinel-policy')
          .filter((policy) => policy !== this.policy)
          .findBy('name', this.policy.name)
      ) {
        throw new Error(
          `A sentinel policy with name ${this.policy.name} already exists.`
        );
      }
      this.policy.set('id', this.policy.name);
      await this.policy.save();

      this.notifications.add({
        title: 'Sentinel Policy Saved',
        color: 'success',
      });

      if (shouldRedirectAfterSave) {
        // TODO: GO TO THE SHOW PAGE INSTEAD
        this.router.transitionTo('sentinel-policies.policy', this.policy.name);
      }
    } catch (err) {
      let message = err.errors?.length
        ? messageFromAdapterError(err)
        : err.message || 'Unknown Error';

      this.notifications.add({
        title: `Error creating Sentinel Policy ${this.policy.name}`,
        message,
        color: 'critical',
        sticky: true,
      });
    }
  }
}