var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var settingsSchema = new Schema({
  servicename: String,
  configsettings: {
    type: Map,
    of: Schema.Types.Mixed
  }
});

var ServiceSettings = mongoose.model('ServiceSettings', settingsSchema);
module.exports = ServiceSettings;