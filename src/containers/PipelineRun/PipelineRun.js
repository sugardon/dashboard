/*
Copyright 2019-2021 The Tekton Authors
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, { useEffect, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { PipelineRun, Rerun } from '@tektoncd/dashboard-components';
import {
  getTaskRunsWithPlaceholders,
  labels as labelConstants,
  queryParams as queryParamConstants,
  urls,
  useTitleSync,
  useWebSocketReconnected
} from '@tektoncd/dashboard-utils';
import { InlineNotification } from 'carbon-components-react';
import { Link } from 'react-router-dom';
import { injectIntl } from 'react-intl';

import {
  getClusterTasks,
  getExternalLogsURL,
  getPipeline,
  getPipelineRun,
  getPipelineRunsErrorMessage,
  getTaskRunsByPipelineRunName,
  getTaskRunsErrorMessage,
  getTasks,
  getTasksErrorMessage,
  isWebSocketConnected,
  isLogStreamingEnabled as selectIsLogStreamingEnabled,
  isReadOnly as selectIsReadOnly
} from '../../reducers';
import { fetchPipelineRun as fetchPipelineRunActionCreator } from '../../actions/pipelineRuns';
import { fetchPipeline as fetchPipelineActionCreator } from '../../actions/pipelines';
import {
  fetchClusterTasks as fetchClusterTasksActionCreator,
  fetchTasks as fetchTasksActionCreator
} from '../../actions/tasks';
import { fetchTaskRuns as fetchTaskRunsActionCreator } from '../../actions/taskRuns';
import { rerunPipelineRun } from '../../api';

import {
  getLogsRetriever,
  getLogsToolbar,
  getViewChangeHandler
} from '../../utils';

const { PIPELINE_TASK, RETRY, STEP, VIEW } = queryParamConstants;

export /* istanbul ignore next */ function PipelineRunContainer(props) {
  const {
    clusterTasks,
    error,
    fetchClusterTasks,
    fetchPipeline,
    fetchPipelineRun,
    fetchTaskRuns,
    fetchTasks,
    history,
    intl,
    location,
    match,
    pipelineRun,
    pipelineTaskName: currentPipelineTaskName,
    retry: currentRetry,
    selectedStepId: currentSelectedStepId,
    tasks,
    taskRuns,
    view,
    webSocketConnected
  } = props;

  const { namespace, pipelineRunName } = match.params;

  const maximizedLogsContainer = useRef();
  const [loading, setLoading] = useState(true);
  const [showRerunNotification, setShowRerunNotification] = useState(null);

  useTitleSync({
    page: 'PipelineRun',
    resourceName: pipelineRunName
  });

  async function fetchResources() {
    const [run] = await Promise.all([
      fetchPipelineRun({ name: pipelineRunName, namespace }),
      fetchTaskRuns({
        filters: [`${labelConstants.PIPELINE_RUN}=${pipelineRunName}`]
      }),
      // TODO: only request the Tasks / ClusterTasks we actually need
      //       move these to the Promise.all below, with `fetchPipeline`
      fetchTasks(),
      fetchClusterTasks()
    ]);
    const pipelineName = run?.spec.pipelineRef?.name;
    await Promise.all([
      pipelineName
        ? fetchPipeline({ name: pipelineName, namespace })
        : Promise.resolve()
    ]);

    setLoading(false);
  }

  function fetchData({ skipLoading } = {}) {
    setLoading(!skipLoading);
    fetchResources();
  }

  useEffect(() => {
    fetchData();
  }, [namespace, pipelineRunName]);

  useWebSocketReconnected(() => {
    fetchData({ skipLoading: true });
  }, webSocketConnected);

  function getSelectedTaskId(pipelineTaskName, retry) {
    const taskRun = taskRuns.find(
      ({ metadata }) =>
        metadata.labels &&
        ((metadata.labels[labelConstants.CONDITION_CHECK] &&
          metadata.labels[labelConstants.CONDITION_CHECK] ===
            pipelineTaskName) ||
          // the `pipelineTask` label is present on both TaskRuns (the owning
          // TaskRun and the TaskRun created for the condition check), ensure
          // we only match on the owning TaskRun here and not another condition
          (!metadata.labels[labelConstants.CONDITION_CHECK] &&
            metadata.labels[labelConstants.PIPELINE_TASK] === pipelineTaskName))
    );

    if (!taskRun) {
      return null;
    }

    const retryNumber = parseInt(retry, 10);
    if (!Number.isNaN(retryNumber) && taskRun.status?.retriesStatus) {
      const retryStatus = taskRun.status.retriesStatus[retryNumber];
      return retryStatus && taskRun.metadata.uid + retryStatus.podName;
    }

    return taskRun.metadata.uid + taskRun.status?.podName;
  }

  function getSelectedTaskRun(selectedTaskId) {
    const lookup = taskRuns.reduce((acc, taskRun) => {
      const { labels, uid } = taskRun.metadata;
      const pipelineTaskName =
        labels &&
        (labels[labelConstants.CONDITION_CHECK] ||
          labels[labelConstants.PIPELINE_TASK]);
      const { podName, retriesStatus } = taskRun.status || {};
      acc[uid + podName] = {
        pipelineTaskName,
        uid
      };
      if (retriesStatus) {
        retriesStatus.forEach((retryStatus, index) => {
          acc[uid + retryStatus.podName] = {
            pipelineTaskName,
            retry: index,
            uid
          };
        });
      }
      return acc;
    }, {});
    return lookup[selectedTaskId];
  }

  function handleTaskSelected(selectedTaskId, selectedStepId) {
    const { pipelineTaskName, retry } = getSelectedTaskRun(selectedTaskId);
    const queryParams = new URLSearchParams(location.search);

    queryParams.set(PIPELINE_TASK, pipelineTaskName);
    if (selectedStepId) {
      queryParams.set(STEP, selectedStepId);
    } else {
      queryParams.delete(STEP);
    }

    if (Number.isInteger(retry)) {
      queryParams.set(RETRY, retry);
    } else {
      queryParams.delete(RETRY);
    }

    const currentTaskId = getSelectedTaskId(
      currentPipelineTaskName,
      currentRetry
    );
    if (
      selectedStepId !== currentSelectedStepId ||
      selectedTaskId !== currentTaskId
    ) {
      queryParams.delete(VIEW);
    }

    const browserURL = match.url.concat(`?${queryParams.toString()}`);
    history.push(browserURL);
  }

  if (!pipelineRun) {
    return (
      <PipelineRun
        error={intl.formatMessage({
          id: 'dashboard.pipelineRun.notFound',
          defaultMessage: 'PipelineRun not found'
        })}
        loading={false}
      />
    );
  }

  if (!pipelineRun.status) {
    pipelineRun.status = {
      taskRuns: []
    };
  }
  if (!pipelineRun.status.taskRuns) {
    pipelineRun.status.taskRuns = [];
  }

  const selectedTaskId = getSelectedTaskId(
    currentPipelineTaskName,
    currentRetry
  );

  const rerun = !props.isReadOnly && (
    <Rerun
      getURL={({ name, namespace: resourceNamespace }) =>
        urls.pipelineRuns.byName({
          namespace: resourceNamespace,
          pipelineRunName: name
        })
      }
      run={pipelineRun}
      rerun={rerunPipelineRun}
      showNotification={value => setShowRerunNotification(value)}
    />
  );

  return (
    <>
      <div id="tkn--maximized-logs-container" ref={maximizedLogsContainer} />
      {showRerunNotification && (
        <InlineNotification
          lowContrast
          actions={
            showRerunNotification.logsURL ? (
              <Link
                className="bx--inline-notification__text-wrapper"
                to={showRerunNotification.logsURL}
              >
                {intl.formatMessage({
                  id: 'dashboard.run.rerunStatusMessage',
                  defaultMessage: 'View status'
                })}
              </Link>
            ) : (
              ''
            )
          }
          title={showRerunNotification.message}
          kind={showRerunNotification.kind}
          caption=""
        />
      )}
      <PipelineRun
        error={error}
        fetchLogs={getLogsRetriever(
          props.isLogStreamingEnabled,
          props.externalLogsURL
        )}
        handleTaskSelected={handleTaskSelected}
        loading={loading}
        getLogsToolbar={getLogsToolbar}
        maximizedLogsContainer={maximizedLogsContainer.current}
        onViewChange={getViewChangeHandler(props)}
        pipelineRun={pipelineRun}
        rerun={rerun}
        selectedStepId={currentSelectedStepId}
        selectedTaskId={selectedTaskId}
        showIO
        taskRuns={taskRuns}
        tasks={tasks.concat(clusterTasks)}
        view={view}
      />
    </>
  );
}

PipelineRunContainer.propTypes = {
  match: PropTypes.shape({
    params: PropTypes.shape({
      pipelineRunName: PropTypes.string.isRequired
    }).isRequired
  }).isRequired
};

/* istanbul ignore next */
function mapStateToProps(state, ownProps) {
  const { location, match } = ownProps;
  const { namespace } = match.params;

  const queryParams = new URLSearchParams(location.search);
  const pipelineTaskName = queryParams.get(PIPELINE_TASK);
  const retry = queryParams.get(RETRY);
  const selectedStepId = queryParams.get(STEP);
  const view = queryParams.get(VIEW);

  const pipelineRun = getPipelineRun(state, {
    name: ownProps.match.params.pipelineRunName,
    namespace
  });
  const pipelineName = pipelineRun?.spec?.pipelineRef?.name;
  const pipeline =
    pipelineName && getPipeline(state, { name: pipelineName, namespace });
  const clusterTasks = getClusterTasks(state);
  const tasks = getTasks(state, { namespace });
  let taskRuns = getTaskRunsByPipelineRunName(
    state,
    ownProps.match.params.pipelineRunName,
    {
      namespace
    }
  );

  taskRuns = getTaskRunsWithPlaceholders({
    clusterTasks,
    pipeline,
    pipelineRun,
    taskRuns,
    tasks
  });

  return {
    clusterTasks,
    error:
      getPipelineRunsErrorMessage(state) ||
      getTasksErrorMessage(state) ||
      getTaskRunsErrorMessage(state),
    externalLogsURL: getExternalLogsURL(state),
    isReadOnly: selectIsReadOnly(state),
    namespace,
    pipelineRun,
    pipeline,
    pipelineTaskName,
    retry,
    selectedStepId,
    isLogStreamingEnabled: selectIsLogStreamingEnabled(state),
    tasks,
    taskRuns,
    view,
    webSocketConnected: isWebSocketConnected(state)
  };
}

const mapDispatchToProps = {
  fetchClusterTasks: fetchClusterTasksActionCreator,
  fetchPipeline: fetchPipelineActionCreator,
  fetchPipelineRun: fetchPipelineRunActionCreator,
  fetchTasks: fetchTasksActionCreator,
  fetchTaskRuns: fetchTaskRunsActionCreator
};

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(injectIntl(PipelineRunContainer));
