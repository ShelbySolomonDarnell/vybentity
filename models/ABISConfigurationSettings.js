var mongoose   = require('mongoose');
var Schema     = mongoose.Schema;

var abisSchema = new Schema({
  Id: Schema.Types.ObjectId,
  Token: String,
  ABISServerIPAddress: String,
  ABISServerAdminPort: Number,
  FingersMaximalRotation: Number,
  MatchingThreshold: Number,
  IdentificationMatchScore: Number,
  VerificationMatchScore: Number,
  FingersQualityThreshold: Schema.Types.Mixed,
  FingersMinimalMinutiaCount: Number,
  IrisesMaximalRotation: Number,
  IrisesQualityThreshold: Schema.Types.Mixed,
  FacesMaximalRoll: Number,
  FacesQualityThreshold: Schema.Types.Mixed
});

var ABISConfigurationSettings = mongoose.model('ABISConfigurationSettings', abisSchema);
module.exports                = ABISConfigurationSettings;