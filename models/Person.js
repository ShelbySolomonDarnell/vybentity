var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var personSchema = new Schema({
  names: {
    surname: String,
    middle: String,
    first: String,
    other: [String]
  },
  dateOfBirth: Date,
  addresses: [{
    name: String,
    place: String,
    street: String,
    city: String,
    county: String,
    zipcode: String,
    country: String
  }],
  driverLicenseNumber: String,
  passport: {
    number: Number,
    issuer: String,
    placeOfIssue: String,
    imageFileLocation: String
  },
  biometricData: [{
    modality: String,
    value: String,
    dateTaken: Date
  }]
});