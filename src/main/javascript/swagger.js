var SwaggerClient = function(url, options) {
  this.isBuilt = false;
  this.url = null;
  this.debug = false;
  this.basePath = null;
  this.authorizations = null;
  this.authorizationScheme = null;
  this.isValid = false;
  this.info = null;
  this.useJQuery = false;

  options = (options||{});
  if (url)
    if (url.url) options = url;
    else this.url = url;
  else options = url;

  if (options.url != null)
    this.url = options.url;

  if (options.success != null)
    this.success = options.success;

  if (typeof options.useJQuery === 'boolean')
    this.useJQuery = options.useJQuery;

  this.failure = options.failure != null ? options.failure : function() {};
  this.progress = options.progress != null ? options.progress : function() {};
  if (options.success != null)
    this.build();
}

SwaggerClient.prototype.build = function() {
  var self = this;
  this.progress('fetching resource list: ' + this.url);
  var obj = {
    useJQuery: this.useJQuery,
    url: this.url,
    method: "get",
    headers: {
      accept: "application/json, */*"
    },
    on: {
      error: function(response) {
        if (self.url.substring(0, 4) !== 'http')
          return self.fail('Please specify the protocol for ' + self.url);
        else if (response.status === 0)
          return self.fail('Can\'t read from server.  It may not have the appropriate access-control-origin settings.');
        else if (response.status === 404)
          return self.fail('Can\'t read swagger JSON from ' + self.url);
        else
          return self.fail(response.status + ' : ' + response.statusText + ' ' + self.url);
      },
      response: function(resp) {
        var responseObj = resp.obj || JSON.parse(resp.data);
        self.swaggerVersion = responseObj.swaggerVersion;

        if(responseObj.swagger && responseObj.swagger === 2.0) {
          self.swaggerVersion = responseObj.swagger;
          self.buildFromSpec(responseObj);
          this.isValid = true;
        }
        else
          this.isValid = false;
      }
    }
  };
  var e = (typeof window !== 'undefined' ? window : exports);
  e.authorizations.apply(obj);
  new SwaggerHttp().execute(obj);
  return this;
};

SwaggerClient.prototype.buildFromSpec = function(response) {
  if(this.isBuilt)
    return this;
  this.info = response.info || {};
  this.title = response.title || '';
  this.host = response.host || '';
  this.schemes = response.schemes || [ 'http' ];
  this.basePath = response.basePath || '';
  this.apis = {};
  this.apisArray = [];
  this.consumes = response.consumes;
  this.produces = response.produces;
  this.authSchemes = response.authorizations;

  if(typeof this.host === 'undefined' || this.host === '') {
    var location = this.parseUri(this.url);
    this.host = location.host;
  }

  this.definitions = response.definitions;
  var key;
  for(key in this.definitions) {
    var model = new Model(key, this.definitions[key]);
    if(model) {
      models[key] = model;
    }
  }

  // get paths, create functions for each operationId
  var path;
  var operations = [];
  for(path in response.paths) {
    var httpMethod;
    for(httpMethod in response.paths[path]) {
      var operation = response.paths[path][httpMethod];
      var tags = operation.tags;
      if(typeof tags === undefined)
        tags = [];
      var operationId = this.idFromOp(path, httpMethod, operation);
      var operation = new Operation (
        this,
        operationId,
        httpMethod,
        path,
        operation,
        this.definitions
      );
      // bind this operation's execute command to the api
      if(tags.length > 0) {
        var i;
        for(i = 0; i < tags.length; i++) {
          var tag = this.tagFromLabel(tags[i]);
          var operationGroup = this[tag];
          if(typeof operationGroup === 'undefined') {
            this[tag] = [];
            operationGroup = this[tag];
            operationGroup.label = tag;
            operationGroup.apis = [];
            this[tag].help = this.help.bind(operationGroup);
            this.apisArray.push(new OperationGroup(tag, operation));
          }
          operationGroup[operationId] = operation.execute.bind(operation);
          operationGroup[operationId].help = operation.help.bind(operation);
          operationGroup.apis.push(operation);

          // legacy UI feature
          var j;
          var api = null;
          for(j = 0; j < this.apisArray.length; j++) {
            if(this.apisArray[j].tag === tag) {
              api = this.apisArray[j];
            }
          }
          if(api) {
            api.operationsArray.push(operation);
          }
        }
      }
      else {
        log('no group to bind to');
      }
    }
  }
  this.isBuilt = true;
  if (this.success)
    this.success();
  return this;
}

SwaggerClient.prototype.parseUri = function(uri) {
  var urlParseRE = /^(((([^:\/#\?]+:)?(?:(\/\/)((?:(([^:@\/#\?]+)(?:\:([^:@\/#\?]+))?)@)?(([^:\/#\?\]\[]+|\[[^\/\]@#?]+\])(?:\:([0-9]+))?))?)?)?((\/?(?:[^\/\?#]+\/+)*)([^\?#]*)))?(\?[^#]+)?)(#.*)?/;
  var parts = urlParseRE.exec(uri);
  return {
    scheme: parts[4].replace(':',''),
    host: parts[11],
    path: parts[15]
  };
}

SwaggerClient.prototype.help = function() {
  var i;
  log('operations for the "' + this.label + '" tag');
  for(i = 0; i < this.apis.length; i++) {
    var api = this.apis[i];
    log('  * ' + api.nickname + ': ' + api.operation.summary);
  }
}

SwaggerClient.prototype.tagFromLabel = function(label) {
  return label;
}

SwaggerClient.prototype.idFromOp = function(path, httpMethod, op) {
  if(typeof op.operationId !== 'undefined') {
    return (op.operationId);
  }
  else {
    return path.substring(1).replace(/\//g, "_").replace(/\{/g, "").replace(/\}/g, "") + "_" + httpMethod;
  }
}

SwaggerClient.prototype.fail = function(message) {
  this.failure(message);
  throw message;
};

var OperationGroup = function(tag, operation) {
  this.tag = tag;
  this.path = tag;
  this.name = tag;
  this.operation = operation;
  this.operationsArray = [];

  this.description = operation.description || "";
}

var Operation = function(parent, operationId, httpMethod, path, args, definitions) {
  var errors = [];
  this.operation = args;
  this.consumes = args.consumes;
  this.produces = args.produces;
  this.parent = parent;
  this.host = parent.host;
  this.schemes = parent.schemes;
  this.basePath = parent.basePath;
  this.nickname = (operationId||errors.push('Operations must have a nickname.'));
  this.method = (httpMethod||errors.push('Operation ' + operationId + ' is missing method.'));
  this.path = (path||errors.push('Operation ' + nickname + ' is missing path.'));
  this.parameters = args != null ? (args.parameters||[]) : {};
  this.summary = args.summary || '';
  this.responses = (args.responses||{});
  this.type = null;

  // this.authorizations = authorizations;

  var i;
  for(i = 0; i < this.parameters.length; i++) {
    var param = this.parameters[i];
    type = this.getType(param);

    param.signature = this.getSignature(type, models);
    param.sampleJSON = this.getSampleJSON(type, models);
    param.responseClassSignature = param.signature;
  }

  var response;
  var model;
  var responses = this.responses;

  if(responses['200'])
    response = responses['200'];
  else if(responses['default'])
    response = responses['default'];
  if(response && response.schema) {
    var resolvedModel = this.resolveModel(response.schema, definitions);
    if(resolvedModel) {
      this.type = resolvedModel.name;
      this.responseSampleJSON = JSON.stringify(resolvedModel.getSampleValue(), null, 2);
      this.responseClassSignature = resolvedModel.getMockSignature();
    }
    else {
      this.type = response.schema.type;
    }
  }
  // else
  //   this.responseClassSignature = '';

  if (errors.length > 0)
    this.resource.api.fail(errors);

  return this;
}

OperationGroup.prototype.sort = function(sorter) {

}

Operation.prototype.getType = function (param) {
  var type = param.type;
  var format = param.format;
  var isArray = false;
  var str;
  if(type === 'integer' && format === 'int32')
    str = 'integer';
  else if(type === 'integer' && format === 'int64')
    str = 'long';
  else if(type === 'string' && format === 'date-time')
    str = 'date-time';
  else if(type === 'string' && format === 'date')
    str = 'date';
  else if(type === 'number' && format === 'float')
    str = 'float';
  else if(type === 'number' && format === 'double')
    str = 'double';
  else if(type === 'boolean')
    str = 'boolean';
  else if(type === 'string')
    str = 'string';
  else if(type === 'array') {
    isArray = true;
    if(param.items) {
      str = this.getType(param.items);
    }
  }
  if(param['$ref'])
    str = param['$ref'];

  var schema = param.schema;
  if(schema) {
    var ref = schema['$ref'];
    if(ref) {
      ref = simpleRef(ref);
      if(isArray)
        return [ref];
      else
        return ref;
    }
    else
      return this.getType(schema);
  }
  if(isArray)
    return [str];
  else
    return str;
}

Operation.prototype.resolveModel = function (schema, definitions) {
  if(typeof schema['$ref'] !== 'undefined') {
    var ref = schema['$ref'];
    if(ref.indexOf('#/definitions/') == 0)
      ref = ref.substring('#/definitions/'.length);
    if(definitions[ref])
      return new Model(ref, definitions[ref]);
  }
  if(schema.type === 'array')
    return new ArrayModel(schema);
  else
    return null;
    // return new PrimitiveModel(schema);
  // else

  //   var ref = schema.items['$ref'];
  //   if(ref.indexOf('#/definitions/') === 0)
  //     ref = ref.substring('#/definitions/'.length);
  //   return new Model('name', models[ref]);
  // }
  // else
  //   return new Model('name', schema);
}

Operation.prototype.help = function() {
  log(this.nickname + ': ' + this.operation.summary);
  for(var i = 0; i < this.parameters.length; i++) {
    var param = this.parameters[i];
    log('  * ' + param.name + ': ' + param.description);
  }
}

Operation.prototype.getSignature = function(type, models) {
  var isPrimitive, listType;

  if(type instanceof Array) {
    listType = true;
    type = type[0];
  }

  // listType = this.isListType(type);
  if(type === 'string')
    isPrimitive = true
  else
    isPrimitive = ((listType != null) && models[listType]) || (models[type] != null) ? false : true;
  if (isPrimitive) {
    return type;
  } else {
    if (listType != null) {
      return models[type].getMockSignature();
    } else {
      return models[type].getMockSignature();
    }
  }
};

Operation.prototype.getSampleJSON = function(type, models) {
  var isPrimitive, listType, sampleJson;

  listType = (type instanceof Array);
  isPrimitive = (models[type] != null) ? false : true;
  sampleJson = isPrimitive ? void 0 : models[type].createJSONSample();

  if (sampleJson) {
    sampleJson = listType ? [sampleJson] : sampleJson;
    if(typeof sampleJson == 'string')
      return sampleJson;
    else if(typeof sampleJson === 'object') {
      var t = sampleJson;
      if(sampleJson instanceof Array && sampleJson.length > 0) {
        t = sampleJson[0];
      }
      if(t.nodeName) {
        var xmlString = new XMLSerializer().serializeToString(t);
        return this.formatXml(xmlString);
      }
      else
        return JSON.stringify(sampleJson, null, 2);
    }
    else
      return sampleJson;
  }
};

// legacy support
Operation.prototype["do"] = function(args, opts, callback, error, parent) {
  return this.execute(args, opts, callback, error, parent);
}

Operation.prototype.execute = function(arg1, arg2, arg3, arg4, parent) {
  var args = (arg1||{});
  var opts = {}, success, error;
  if(typeof arg2 === 'object') {
    opts = arg2;
    success = arg3;
    error = arg4;
  }
  if(typeof arg2 === 'function') {
    success = arg2;
    error = arg3;
  }

  var formParams = {};
  var headers = {};
  var requestUrl = this.path;

  success = (success||log)
  error = (error||log)

  var requiredParams = [];
  var missingParams = [];
  // check required params
  for(var i = 0; i < this.parameters.length; i++) {
    var param = this.parameters[i];
    if(param.required === true) {
      requiredParams.push(param.name);
      if(typeof args[param.name] === 'undefined')
        missingParams = param.name;
    }
  }

  if(missingParams.length > 0) {
    var message = 'missing required params: ' + missingParams;
    fail(message);
    return;
  }

  // set content type negotiation
  var consumes = this.consumes || this.parent.consumes || [ 'application/json' ];
  var produces = this.produces || this.parent.produces || [ 'application/json' ];

  headers = this.setContentTypes(args, opts);

  // grab params from the args, build the querystring along the way
  var querystring = "";
  for(var i = 0; i < this.parameters.length; i++) {
    var param = this.parameters[i];
    if(typeof args[param.name] !== 'undefined') {
      if(param.in === 'path') {
        var reg = new RegExp('\{' + param.name + '[^\}]*\}', 'gi');
        requestUrl = requestUrl.replace(reg, this.encodePathParam(args[param.name]));
      }
      else if (param.in === 'query') {
        if(querystring === '')
          querystring += '?';
        if(typeof param.collectionFormat !== 'undefined') {
          var qp = args[param.name];
          if(Array.isArray(qp))
            querystring += this.encodeCollection(param.collectionFormat, param.name, qp);
          else
            querystring += this.encodeQueryParam(param.name) + '=' + this.encodeQueryParam(args[param.name]);
        }
        else
          querystring += this.encodeQueryParam(param.name) + '=' + this.encodeQueryParam(args[param.name]);
      }
      else if (param.in === 'header')
        headers[param.name] = args[param.name];
      else if (param.in === 'form')
        formParams[param.name] = args[param.name];
    }
  }
  var scheme = this.schemes[0];
  var url = scheme + '://' + this.host + this.basePath + requestUrl + querystring;

  var obj = {
    url: url,
    method: args.method,
    useJQuery: this.useJQuery,
    headers: headers,
    on: {
      response: function(response) {
        return success(response, parent);
      },
      error: function(response) {
        return error(response, parent);
      }
    }
  };
  new SwaggerHttp().execute(obj);
}

Operation.prototype.setContentTypes = function(args, opts) {
  // default type
  var accepts = 'application/json';
  var consumes = 'application/json';

  var allDefinedParams = this.parameters;
  var definedFormParams = [];
  var definedFileParams = [];
  var body = args.body;
  var headers = {};

  // get params from the operation and set them in definedFileParams, definedFormParams, headers
  var i;
  for(i = 0; i < allDefinedParams.length; i++) {
    var param = allDefinedParams[i];
    if(param.in === 'form')
      definedFormParams.push(param);
    else if(param.in === 'file')
      definedFileParams.push(param);
    else if(param.in === 'header' && this.params.headers) {
      var key = param.name;
      var headerValue = this.params.headers[param.name];
      if(typeof this.params.headers[param.name] !== 'undefined')
        headers[key] = headerValue;
    }
  }

  // if there's a body, need to set the accepts header via requestContentType
  if (body && (this.type === 'post' || this.type === 'put' || this.type === 'patch' || this.type === 'delete')) {
    if (opts.requestContentType)
      consumes = opts.requestContentType;
  } else {
    // if any form params, content type must be set
    if(definedFormParams.length > 0) {
      if(definedFileParams.length > 0)
        consumes = 'multipart/form-data';
      else
        consumes = 'application/x-www-form-urlencoded';
    }
    else if (this.type == 'DELETE')
      body = '{}';
    else if (this.type != 'DELETE')
      accepts = null;
  }

  if (consumes && this.consumes) {
    if (this.consumes.indexOf(consumes) === -1) {
      log('server doesn\'t consume ' + consumes + ', try ' + JSON.stringify(this.consumes));
      consumes = this.operation.consumes[0];
    }
  }

  if (opts.responseContentType) {
    accepts = opts.responseContentType;
  } else {
    accepts = 'application/json';
  }
  if (accepts && this.produces) {
    if (this.produces.indexOf(accepts) === -1) {
      log('server can\'t produce ' + accepts);
      accepts = this.produces[0];
    }
  }

  if ((consumes && body !== '') || (consumes === 'application/x-www-form-urlencoded'))
    headers['Content-Type'] = consumes;
  if (accepts)
    headers['Accept'] = accepts;
  return headers;
}

Operation.prototype.encodeCollection = function(type, name, value) {
  var encoded = '';
  var i;
  if(type === 'jaxrs') {
    for(i = 0; i < value.length; i++) {
      if(i > 0) encoded += '&'
      encoded += this.encodeQueryParam(name) + '=' + this.encodeQueryParam(value[i]);
    }
  }
  return encoded;
}

Operation.prototype.encodeQueryParam = function(arg) {
  return escape(arg);
}

Operation.prototype.encodePathParam = function(pathParam) {
  var encParts, part, parts, _i, _len;
  pathParam = pathParam.toString();
  if (pathParam.indexOf('/') === -1) {
    return encodeURIComponent(pathParam);
  } else {
    parts = pathParam.split('/');
    encParts = [];
    for (_i = 0, _len = parts.length; _i < _len; _i++) {
      part = parts[_i];
      encParts.push(encodeURIComponent(part));
    }
    return encParts.join('/');
  }
};

Operation.prototype.encodePathParam = function(pathParam) {
  var encParts, part, parts, _i, _len;
  pathParam = pathParam.toString();
  if (pathParam.indexOf('/') === -1) {
    return encodeURIComponent(pathParam);
  } else {
    parts = pathParam.split('/');
    encParts = [];
    for (_i = 0, _len = parts.length; _i < _len; _i++) {
      part = parts[_i];
      encParts.push(encodeURIComponent(part));
    }
    return encParts.join('/');
  }
};

var ArrayModel = function(definition) {
  this.name = "name";
  this.definition = definition || {};
  this.properties = [];
  this.type;
  this.ref;

  var requiredFields = definition.enum || [];
  var items = definition.items;
  if(items) {
    var type = items.type;
    if(items.type) {
      this.type = typeFromJsonSchema(type.type, type.format);
    }
    else {
      this.ref = items['$ref'];
    }
  }
}

ArrayModel.prototype.createJSONSample = function(modelsToIgnore) {
  var result;
  var modelsToIgnore = (modelsToIgnore||[])
  if(this.type) {
    result = type;
  }
  else if (this.ref) {
    var name = simpleRef(this.ref);
    result = models[name].createJSONSample();
  }
  return [ result ];
};

ArrayModel.prototype.getSampleValue = function() {
  var result;
  var modelsToIgnore = (modelsToIgnore||[])
  if(this.type) {
    result = type;
  }
  else if (this.ref) {
    var name = simpleRef(this.ref);
    result = models[name].getSampleValue();
  }
  return [ result ];
}

ArrayModel.prototype.getMockSignature = function(modelsToIgnore) {
  var propertiesStr = [];

  if(this.ref) {
    return models[simpleRef(this.ref)].getMockSignature();
  }
};


var PrimitiveModel = function(definition) {
  this.name = "name";
  this.definition = definition || {};
  this.properties = [];
  this.type;

  var requiredFields = definition.enum || [];
  this.type = typeFromJsonSchema(definition.type, definition.format);
}

PrimitiveModel.prototype.createJSONSample = function(modelsToIgnore) {
  var result = this.type;
  return result;
};

PrimitiveModel.prototype.getSampleValue = function() {
  var result = this.type;
  return null;
}

PrimitiveModel.prototype.getMockSignature = function(modelsToIgnore) {
  var propertiesStr = [];
  var i;
  for (i = 0; i < this.properties.length; i++) {
    var prop = this.properties[i];
    propertiesStr.push(prop.toString());
  }

  var strong = '<span class="strong">';
  var stronger = '<span class="stronger">';
  var strongClose = '</span>';
  var classOpen = strong + this.name + ' {' + strongClose;
  var classClose = strong + '}' + strongClose;
  var returnVal = classOpen + '<div>' + propertiesStr.join(',</div><div>') + '</div>' + classClose;
  if (!modelsToIgnore)
    modelsToIgnore = [];

  modelsToIgnore.push(this.name);
  var i;
  for (i = 0; i < this.properties.length; i++) {
    var prop = this.properties[i];
    var ref = prop['$ref'];
    var model = models[ref];
    if (model && modelsToIgnore.indexOf(ref) === -1) {
      returnVal = returnVal + ('<br>' + model.getMockSignature(modelsToIgnore));
    }
  }
  return returnVal;
};

var Model = function(name, definition) {
  this.name = name;
  this.definition = definition || {};
  this.properties = [];
  var requiredFields = definition.enum || [];

  var key;
  var props = definition.properties;
  if(props) {
    for(key in props) {
      var required = false;
      var property = props[key];
      if(requiredFields.indexOf(key) >= 0)
        required = true;
      this.properties.push(new Property(key, property, required));
    }    
  }
}

Model.prototype.createJSONSample = function(modelsToIgnore) {
  var result = {};
  var modelsToIgnore = (modelsToIgnore||[])
  modelsToIgnore.push(this.name);
  for (var i = 0; i < this.properties.length; i++) {
    prop = this.properties[i];
    result[prop.name] = prop.getSampleValue(modelsToIgnore);
  }
  modelsToIgnore.pop(this.name);
  return result;
};

Model.prototype.getSampleValue = function() {
  var i;
  var obj = {};
  for(i = 0; i < this.properties.length; i++ ) {
    var property = this.properties[i];
    obj[property.name] = property.sampleValue();
  }
  return obj;
}

Model.prototype.getMockSignature = function(modelsToIgnore) {
  var propertiesStr = [];
  var i;
  for (i = 0; i < this.properties.length; i++) {
    var prop = this.properties[i];
    propertiesStr.push(prop.toString());
  }

  var strong = '<span class="strong">';
  var stronger = '<span class="stronger">';
  var strongClose = '</span>';
  var classOpen = strong + this.name + ' {' + strongClose;
  var classClose = strong + '}' + strongClose;
  var returnVal = classOpen + '<div>' + propertiesStr.join(',</div><div>') + '</div>' + classClose;
  if (!modelsToIgnore)
    modelsToIgnore = [];

  modelsToIgnore.push(this.name);
  var i;
  for (i = 0; i < this.properties.length; i++) {
    var prop = this.properties[i];
    var ref = prop['$ref'];
    var model = models[ref];
    if (model && modelsToIgnore.indexOf(ref) === -1) {
      returnVal = returnVal + ('<br>' + model.getMockSignature(modelsToIgnore));
    }
  }
  return returnVal;
};

var Property = function(name, obj, required) {
  this.schema = obj;
  this.required = required;
  if(obj['$ref']) {
    var refType = obj['$ref'];
    refType = refType.indexOf('#/definitions') === -1 ? refType : refType.substring('#/definitions').length;
    this['$ref'] = refType;
  }
  else if (obj.type === 'array') {
    if(obj.items['$ref'])
      this['$ref'] = obj.items['$ref'];
    else
      obj = obj.items;
  }
  this.name = name;
  this.obj = obj;
  this.optional = true;
  this.example = obj.example || null;
}

Property.prototype.getSampleValue = function () {
  return this.sampleValue(false);
}

Property.prototype.isArray = function () {
  var schema = this.schema;
  if(schema.type === 'array')
    return true;
  else
    return false;
}

Property.prototype.sampleValue = function(isArray, ignoredModels) {
  isArray = (isArray || this.isArray());
  ignoredModels = (ignoredModels || {})
  var type = getStringSignature(this.obj);
  var output;

  if(this['$ref']) {
    var refModel = models[this['$ref']];
    if(refModel && typeof ignoredModels[refModel] === 'undefined') {
      output = refModel.getSampleValue(ignoredModels);
    }
    else
      type = refModel;
  }
  else if(this.example)
    output = this.example;
  else if(type === 'date-time') {
    output = new Date().toISOString();
  }
  else if(type === 'string') {
    output = 'string';
  }
  else if(type === 'integer') {
    output = 0;
  }
  else if(type === 'long') {
    output = 0;
  }
  else if(type === 'float') {
    output = 0.0;
  }
  else if(type === 'double') {
    output = 0.0;
  }
  else if(type === 'boolean') {
    output = true;
  }
  else
    output = {};
  if(isArray) return [output];
  else return output;
}

getStringSignature = function(obj) {
  var str = '';
  if(obj.type === 'array') {
    obj = (obj.items || obj['$ref'] || {});
    str += 'Array[';
  }
  if(obj.type === 'integer' && obj.format === 'int32')
    str += 'integer';
  else if(obj.type === 'integer' && obj.format === 'int64')
    str += 'long';
  else if(obj.type === 'string' && obj.format === 'date-time')
    str += 'date-time';
  else if(obj.type === 'string' && obj.format === 'date')
    str += 'date';
  else if(obj.type === 'number' && obj.format === 'float')
    str += 'float';
  else if(obj.type === 'number' && obj.format === 'double')
    str += 'double';
  else if(obj.type === 'boolean')
    str += 'boolean';
  else
    str += obj.type || obj['$ref'];
  if(obj.type === 'array')
    str += ']';
  return str;
}

simpleRef = function(name) {
  if(name.indexOf("#/definitions/") === 0)
    return name.substring('#/definitions/'.length)
  else
    return name;
}

Property.prototype.toString = function() {
  var str = getStringSignature(this.obj);
  if(str !== '')
    str = this.name + ' : ' + str;
  else 
    str = this.name + ' : ' + JSON.stringify(this.obj);
  if(!this.required)
    str += ' (optional)';
  return str;
}

typeFromJsonSchema = function(type, format) {
  var str;
  if(type === 'integer' && format === 'int32')
    str = 'integer';
  else if(type === 'integer' && format === 'int64')
    str = 'long';
  else if(type === 'string' && format === 'date-time')
    str = 'date-time';
  else if(type === 'string' && format === 'date')
    str = 'date';
  else if(type === 'number' && format === 'float')
    str = 'float';
  else if(type === 'number' && format === 'double')
    str = 'double';
  else if(type === 'boolean')
    str = 'boolean';
  else if(type === 'string')
    str = 'string';

  return str;
}

var e = (typeof window !== 'undefined' ? window : exports);

var sampleModels = {};
var cookies = {};
var models = {};

e.authorizations = new SwaggerAuthorizations();
e.ApiKeyAuthorization = ApiKeyAuthorization;
e.PasswordAuthorization = PasswordAuthorization;
e.CookieAuthorization = CookieAuthorization;
e.SwaggerClient = SwaggerClient;