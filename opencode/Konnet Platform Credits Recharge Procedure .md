**Konnet Platform Credits Recharge Flow** (Dedicated Virtual Account)

**Objective**

Provide a simple, trusted, and frictionless way for users to purchase platform credits without leaving the familiar banking channels they already use.

Every konnet user is automatically assigned a permanent Dedicated Virtual Account during registration. This account is used exclusively for funding their konnet wallet.

**Business Principle**

One User → One konnet Account → One Permanent Virtual Account → One Credit Wallet

Users never need to request payment details or generate payment links.

Whenever they want to recharge, the same account details are displayed.

**Vendor Onboarding**

The first time a user interacts with konnet on WhatsApp:

1\. System creates a user account.  
2\. System creates a credit wallet.  
3\. System requests a Dedicated Virtual Account from Paystack.  
4\. Paystack assigns a unique bank account to the user.  
5\. System permanently links that Virtual Account to the user's wallet.

This happens only once.

**Recharge User Experience**

Whenever a user needs credits:

User:  “Recharge”

konnet responds with:

Current Balance

18 Credits

━━━━━━━━━━━━━━━━━━

Transfer money to your konnet Funding Account

Bank:  
Paystack Bank

Account Number:  
8134567892

Account Name:  
konnet \- Collins

━━━━━━━━━━━━━━━━━━

Your credits will be added automatically  
once payment is received.

**User Experience Benefits** 

No payment links.

No checkout page.

No QR codes.

No manual payment confirmation.

The user simply transfers money.

**Behind The Scenes**

Step 1

The user transfers money exactly the same way they normally send money.

Step 2

Money arrives in the user's Dedicated Virtual Account.

Step 3

Paystack immediately notifies konnet through a secure webhook that Payment was Received

Step 4

konnet identifies the owner via account info:

Account Number

    ↓

Wallet

    ↓

User

    ↓

Credit Package

Since every account number belongs to only one user, no payment references are required.

Step 5

konnet converts the payment into platform credits.

Example:

₦5,000

     ↓

50 Credits

Step 6

The user's wallet is updated instantly.

Wallet

Before:  
18 Credits

After:  
68 Credits

Step 7

konnet immediately sends a WhatsApp confirmation.

✅ Payment Received

₦5,000 has been received.

50 Credits have been added.

Current Balance:

68 Credits

Super easy, No manual verification is required.

**End-to-End Flow**

User  
    │  
   ▼  
Requests Recharge  
    │  
   ▼  
konnet displays permanent  
Virtual Account  
    │  
   ▼  
User transfers money  
using any banking channel  
    │  
   ▼  
Money reaches  
Dedicated Virtual Account  
    │  
   ▼  
Paystack sends webhook  
to konnet  
    │  
   ▼  
konnet identifies user  
    │  
   ▼  
Wallet credited  
    │  
   ▼  
WhatsApp confirmation sent to user 

**Business Benefits**

**1\. Familiar Experience**

Users pay exactly as they already do every day.

No learning curve.

**2\. No Checkout Pages**

Users do not interact with external payment pages.

The conversation remains the primary interface.

**3\. No Payment Links**

No links need to be generated.

The same Virtual Account is reused forever.

**4\. Automatic Reconciliation**

Each Virtual Account belongs to only one user.

Every payment can be matched automatically.

**5\. Faster Repeat Payments**

Returning users already know their funding account.

Recharging becomes almost effortless.

**6\. Highly Scalable**

The process remains identical whether konnet has:

\* 100 users  
\* 10,000 users  
\* 1 million users

No additional operational complexity is introduced.

**Feature Summary**

The Dedicated Virtual Account model makes funding a konnet wallet feel as natural as making a normal bank transfer. Users always recharge using the same personal account details, while konnet automatically detects incoming payments, converts them into platform credits, updates the user's wallet, and confirms the transaction within WhatsApp. This keeps the entire experience simple, trustworthy, and scalable while minimizing payment friction.  





## Technical Requirements: Dedicated Virtual Account (DVA) Integration (Test Mode)

## 1. Objective
Implement an automated wallet onboarding flow by integrating Paystack’s Dedicated Virtual Account (DVA) API. This will automatically assign a unique, permanent virtual bank account to every new user who registers on our platform using Paystack's sandbox environment.

## 2. User Flow Summary

   1. Vendor completes onboarding.
   2. Our backend creates a corresponding Customer Profile on Paystack.
   3. Our backend automatically requests a Dedicated Virtual Account for that customer.
   4. The system stores the account details and displays them to the user as their personal wallet funding account.

------------------------------
## 3. Core Technical Steps & API Specifications

## Step 1: Create Paystack Customer
Every virtual account must be tied to a Paystack customer object.

* Endpoint: POST https://paystack.co
* Headers:
* Authorization: Bearer {{PAYSTACK_TEST_SECRET_KEY}}
   * Content-Type: application/json
* Payload Structure:

{
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "phone": "+2348012345678"
}


* Success Criteria: Capture and store the customer_code (e.g., CUS_xnxdt6h1g0bgojg) in our local database against the user's ID.

## Step 2: Request the Virtual Account (Test Mode)
Generate the account immediately after a successful customer creation response.

* Endpoint: POST https://paystack.co
* Headers:
* Authorization: Bearer {{PAYSTACK_TEST_SECRET_KEY}}
   * Content-Type: application/json
* Payload Structure:

{
  "customer": "CUS_xnxdt6h1g0bgojg", 
  "preferred_bank": "test-bank"
}


* Success Criteria: Extract and store the following fields from the Paystack JSON response (data.bank and data.account_number) into our database:
* bank_name (Will return "Test Bank" in sandbox)
   * account_number
   * account_name

------------------------------
## 4. Webhook Handling & Wallet Funding Simulation
To update the user's wallet balance when they "transfer money" to the test account, the engineer must build a webhook listener.

* Webhook Event to Listen For: charge.success
* Verification Required: Implement Paystack IP/Signature validation using our test webhook secret to prevent spoofing.
* Logic Flow:
1. Parse the incoming payload for data.customer.customer_code or data.dedicated_account.account_number.
   2. Locate the corresponding user in our database.
   3. Credit the user's local wallet balance with the value found in data.amount (Note: Paystack sends amounts in kobo/minor units, so divide by 100).

------------------------------
## 5. Acceptance Criteria for Testing

* The system automatically generates a virtual account upon user registration without manual intervention.
* Errors (e.g., missing phone number format) are caught gracefully and retried.
* The user profile UI successfully displays the account number and "Test Bank".
* Triggering a mock charge.success event via the Paystack Dashboard Webhook Simulator successfully increments the target user's wallet balance.



