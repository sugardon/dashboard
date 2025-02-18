/*
Copyright 2020-2021 The Tekton Authors
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

import React, { useEffect } from 'react';
import { connect } from 'react-redux';
import PropTypes from 'prop-types';
import { injectIntl } from 'react-intl';
import { ResourceDetails, Table } from '@tektoncd/dashboard-components';
import {
  useTitleSync,
  useWebSocketReconnected
} from '@tektoncd/dashboard-utils';
import {
  getClusterTriggerBinding,
  getClusterTriggerBindingsErrorMessage,
  isFetchingClusterTriggerBindings,
  isWebSocketConnected
} from '../../reducers';
import { getViewChangeHandler } from '../../utils';
import { fetchClusterTriggerBinding as fetchClusterTriggerBindingActionCreator } from '../../actions/clusterTriggerBindings';

export /* istanbul ignore next */ function ClusterTriggerBindingContainer(
  props
) {
  const {
    clusterTriggerBinding,
    error,
    fetchClusterTriggerBinding,
    intl,
    loading,
    match,
    view,
    webSocketConnected
  } = props;
  const { clusterTriggerBindingName } = match.params;

  useTitleSync({
    page: 'ClusterTriggerBinding',
    resourceName: clusterTriggerBindingName
  });

  function fetchData() {
    fetchClusterTriggerBinding({
      name: clusterTriggerBindingName
    });
  }

  useEffect(() => {
    fetchData();
  }, [clusterTriggerBindingName]);

  useWebSocketReconnected(fetchData, webSocketConnected);

  const headersForParameters = [
    {
      key: 'name',
      header: intl.formatMessage({
        id: 'dashboard.tableHeader.name',
        defaultMessage: 'Name'
      })
    },
    {
      key: 'value',
      header: intl.formatMessage({
        id: 'dashboard.tableHeader.value',
        defaultMessage: 'Value'
      })
    }
  ];

  const rowsForParameters =
    clusterTriggerBinding?.spec.params.map(({ name, value }) => ({
      id: name,
      name,
      value
    })) || [];

  const emptyTextMessage = intl.formatMessage({
    id: 'dashboard.clusterTriggerBinding.noParams',
    defaultMessage: 'No parameters found for this ClusterTriggerBinding.'
  });

  return (
    <ResourceDetails
      error={error}
      loading={loading}
      onViewChange={getViewChangeHandler(props)}
      resource={clusterTriggerBinding}
      view={view}
    >
      <Table
        title={intl.formatMessage({
          id: 'dashboard.parameters.title',
          defaultMessage: 'Parameters'
        })}
        headers={headersForParameters}
        rows={rowsForParameters}
        size="short"
        emptyTextAllNamespaces={emptyTextMessage}
        emptyTextSelectedNamespace={emptyTextMessage}
      />
    </ResourceDetails>
  );
}

ClusterTriggerBindingContainer.propTypes = {
  match: PropTypes.shape({
    params: PropTypes.shape({
      clusterTriggerBindingName: PropTypes.string.isRequired
    }).isRequired
  }).isRequired
};

/* istanbul ignore next */
function mapStateToProps(state, ownProps) {
  const { location, match } = ownProps;
  const { clusterTriggerBindingName } = match.params;

  const queryParams = new URLSearchParams(location.search);
  const view = queryParams.get('view');

  const clusterTriggerBinding = getClusterTriggerBinding(state, {
    name: clusterTriggerBindingName
  });
  return {
    clusterTriggerBinding,
    error: getClusterTriggerBindingsErrorMessage(state),
    loading: isFetchingClusterTriggerBindings(state),
    view,
    webSocketConnected: isWebSocketConnected(state)
  };
}

const mapDispatchToProps = {
  fetchClusterTriggerBinding: fetchClusterTriggerBindingActionCreator
};

export default connect(
  mapStateToProps,
  mapDispatchToProps
)(injectIntl(ClusterTriggerBindingContainer));
