# Patient profile catalog

The canonical patient field catalog and private setup profile are maintained in
[`services/api/catalog/patient-profile.json`](../services/api/catalog/patient-profile.json).
The normalized scenario keys are `fullName`, `dateOfBirth`, `bodyType`,
`reasonForVisit`, and private `diagnosis`; the learner response uses the first
four unchanged. The schema check verifies the profile fields against the
runtime contract.
