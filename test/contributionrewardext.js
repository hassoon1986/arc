import * as helpers from './helpers';
const constants = require('./constants');
const ContributionRewardExt = artifacts.require("./ContributionRewardExt.sol");
const ERC20Mock = artifacts.require('./test/ERC20Mock.sol');
const DaoCreator = artifacts.require("./DaoCreator.sol");
const ControllerCreator = artifacts.require("./ControllerCreator.sol");
const DAOTracker = artifacts.require("./DAOTracker.sol");
const Avatar = artifacts.require("./Avatar.sol");
const Redeemer = artifacts.require("./Redeemer.sol");



export class ContributionRewardParams {
  constructor() {
  }
}

const setupContributionRewardParams = async function(
                                            contributionReward,
                                            accounts,
                                            genesisProtocol,
                                            token,
                                            avatar,
                                            redeemer = helpers.NULL_ADDRESS
                                            ) {
  var contributionRewardParams = new ContributionRewardParams();
  if (genesisProtocol === true) {
    contributionRewardParams.votingMachine = await helpers.setupGenesisProtocol(accounts,token,avatar,helpers.NULL_ADDRESS);
    await contributionReward.initialize(   avatar.address,
                                           contributionRewardParams.votingMachine.genesisProtocol.address,
                                           contributionRewardParams.votingMachine.params,
                                           redeemer);
    } else {
  contributionRewardParams.votingMachine = await helpers.setupAbsoluteVote(helpers.NULL_ADDRESS,50,contributionReward.address);
  await contributionReward.initialize(
                                         avatar.address,
                                         contributionRewardParams.votingMachine.absoluteVote.address,
                                         contributionRewardParams.votingMachine.params,
                                         redeemer
                                         );
  }
  return contributionRewardParams;
};

const setup = async function (accounts,genesisProtocol = false,tokenAddress=0) {
   var testSetup = new helpers.TestSetup();
   testSetup.standardTokenMock = await ERC20Mock.new(accounts[1],100);
   testSetup.contributionRewardExt = await ContributionRewardExt.new();
   var controllerCreator = await ControllerCreator.new({gas: constants.ARC_GAS_LIMIT});
   var daoTracker = await DAOTracker.new({gas: constants.ARC_GAS_LIMIT});
   testSetup.daoCreator = await DaoCreator.new(controllerCreator.address,daoTracker.address,{gas:constants.ARC_GAS_LIMIT});
   if (genesisProtocol) {
      testSetup.reputationArray = [1000,100,0];
   } else {
      testSetup.reputationArray = [2000,4000,7000];
   }
   testSetup.org = await helpers.setupOrganizationWithArrays(testSetup.daoCreator,[accounts[0],accounts[1],accounts[2]],[1000,0,0],testSetup.reputationArray);
   testSetup.contributionRewardExtParams= await setupContributionRewardParams(
                      testSetup.contributionRewardExt,
                      accounts,genesisProtocol,
                      tokenAddress,
                      testSetup.org.avatar);
   var permissions = "0x00000000";
   await testSetup.daoCreator.setSchemes(testSetup.org.avatar.address,
                                        [testSetup.contributionRewardExt.address],
                                        [helpers.NULL_HASH],[permissions],"metaData");
   return testSetup;
};
contract('ContributionRewardExt', accounts => {

    it("initialize", async function() {
       var testSetup = await setup(accounts);
       assert.equal(await testSetup.contributionRewardExt.votingMachine(),testSetup.contributionRewardExtParams.votingMachine.absoluteVote.address);
    });

    it("proposeContributionReward log", async function() {
      var testSetup = await setup(accounts);
      var tx = await testSetup.contributionRewardExt.proposeContributionReward(
                                                                     "description-hash",
                                                                     10,
                                                                     [1,2,3],
                                                                     testSetup.standardTokenMock.address,
                                                                     accounts[0],
                                                                     helpers.NULL_ADDRESS);
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, "NewContributionProposal");
      assert.equal(await helpers.getValueFromLogs(tx, '_avatar',0), testSetup.org.avatar.address, "Wrong log: _avatar");
      assert.equal(await helpers.getValueFromLogs(tx, '_intVoteInterface',0), testSetup.contributionRewardExtParams.votingMachine.absoluteVote.address, "Wrong log: _intVoteInterface");
      assert.equal(await helpers.getValueFromLogs(tx, '_descriptionHash',15), "description-hash", "Wrong log: _contributionDescription");
      assert.equal(await helpers.getValueFromLogs(tx, '_reputationChange',0), 10, "Wrong log: _reputationChange");
      var arr = await helpers.getValueFromLogs(tx, '_rewards',0);
      assert.equal(arr[0].words[0], 1, "Wrong log: _rewards");
      assert.equal(arr[1].words[0], 2, "Wrong log: _rewards");
      assert.equal(arr[2].words[0], 3, "Wrong log: _rewards");
      assert.equal(await helpers.getValueFromLogs(tx, '_externalToken',0), testSetup.standardTokenMock.address, "Wrong log: _externalToken");
      assert.equal(await helpers.getValueFromLogs(tx, '_beneficiary',0), accounts[0], "Wrong log: _beneficiary");
     });

    it("proposeContributionReward check beneficiary==0", async() => {
       var testSetup = await setup(accounts);
       var beneficiary = helpers.NULL_ADDRESS;
       var tx = await testSetup.contributionRewardExt.proposeContributionReward(
                                                                      web3.utils.asciiToHex("description"),
                                                                      0,
                                                                      [0,0,0],
                                                                      testSetup.standardTokenMock.address,
                                                                      beneficiary,
                                                                      helpers.NULL_ADDRESS
                                                                    );
       assert.equal(await helpers.getValueFromLogs(tx, '_beneficiary'),accounts[0]);
    });

    it("execute proposeContributionReward  yes ", async function() {
      var testSetup = await setup(accounts);
      var tx = await testSetup.contributionRewardExt.proposeContributionReward(
                                                                     web3.utils.asciiToHex("description"),
                                                                     0,
                                                                    [0,0,0],
                                                                     testSetup.standardTokenMock.address,
                                                                     accounts[0],
                                                                     helpers.NULL_ADDRESS
                                                                   );
      //Vote with reputation to trigger execution
      var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
      await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[2]});
      var organizationProposal = await testSetup.contributionRewardExt.organizationProposals(proposalId);
      assert.notEqual(organizationProposal.executionTime,0);//executionTime
     });

    it("execute proposeContributionReward  mint reputation ", async function() {
      var testSetup = await setup(accounts);
      var reputationReward = 12;
      var tx = await testSetup.contributionRewardExt.proposeContributionReward(
                                                                     web3.utils.asciiToHex("description"),
                                                                     reputationReward,
                                                                     [0,0,0],
                                                                     testSetup.standardTokenMock.address,
                                                                     accounts[1],
                                                                     helpers.NULL_ADDRESS
                                                                   );
      //Vote with reputation to trigger execution
      var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
      await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[2]});
      tx = await testSetup.contributionRewardExt.redeem(proposalId,[true,false,false,false]);
      assert.equal(tx.logs.length, 1);
      assert.equal(tx.logs[0].event, "RedeemReputation");
      assert.equal(tx.logs[0].args._amount, reputationReward);
      var rep = await testSetup.org.reputation.balanceOf(accounts[1]);
      assert.equal(rep.toNumber(),testSetup.reputationArray[1]+reputationReward);
     });

    it("execute proposeContributionReward  mint tokens ", async function() {
       var testSetup = await setup(accounts);
       var reputationReward = 12;
       var nativeTokenReward = 12;
       var tx = await testSetup.contributionRewardExt.proposeContributionReward(
                                                                      web3.utils.asciiToHex("description"),
                                                                      reputationReward,
                                                                      [nativeTokenReward,0,0],
                                                                      testSetup.standardTokenMock.address,
                                                                      accounts[1],
                                                                      helpers.NULL_ADDRESS
                                                                    );
       //Vote with reputation to trigger execution
       var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
       await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[2]});
       tx = await testSetup.contributionRewardExt.redeem(proposalId,[false,true,false,false]);
       var tokens = await testSetup.org.token.balanceOf(accounts[1]);
       assert.equal(tokens.toNumber(),nativeTokenReward);
    });

    it("execute proposeContributionReward  send ethers ", async function() {
      var testSetup = await setup(accounts);
      var reputationReward = 12;
      var nativeTokenReward = 12;
      var ethReward = 12;
      //send some ether to the org avatar
      var otherAvatar = await Avatar.new('otheravatar', helpers.NULL_ADDRESS, helpers.NULL_ADDRESS);
      await web3.eth.sendTransaction({from:accounts[0],to:testSetup.org.avatar.address, value:20});
      var tx = await testSetup.contributionRewardExt.proposeContributionReward(
                                                                     web3.utils.asciiToHex("description"),
                                                                     reputationReward,
                                                                     [nativeTokenReward,ethReward,0],
                                                                     testSetup.standardTokenMock.address,
                                                                     otherAvatar.address,
                                                                     helpers.NULL_ADDRESS
                                                                   );
      //Vote with reputation to trigger execution
      var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
      await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[2]});
      await testSetup.contributionRewardExt.redeem(proposalId,[false,false,true,false]);
      var eth = await web3.eth.getBalance(otherAvatar.address);
      assert.equal(eth,ethReward);
     });

     it("execute proposeContributionReward  send externalToken ", async function() {
       var testSetup = await setup(accounts);
       //give some tokens to organization avatar
       await testSetup.standardTokenMock.transfer(testSetup.org.avatar.address,30,{from:accounts[1]});
       var reputationReward = 12;
       var nativeTokenReward = 12;
       var ethReward = 12;
       var externalTokenReward = 12;
       //send some ether to the org avatar
       var otherAvatar = await Avatar.new('otheravatar', helpers.NULL_ADDRESS, helpers.NULL_ADDRESS);
       await web3.eth.sendTransaction({from:accounts[0],to:testSetup.org.avatar.address, value:20});
       var tx = await testSetup.contributionRewardExt.proposeContributionReward(
                                                                      web3.utils.asciiToHex("description"),
                                                                      reputationReward,
                                                                      [nativeTokenReward,ethReward,externalTokenReward],
                                                                      testSetup.standardTokenMock.address,
                                                                      otherAvatar.address,
                                                                      helpers.NULL_ADDRESS
                                                                    );
       //Vote with reputation to trigger execution
       var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
       await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[2]});
       await testSetup.contributionRewardExt.redeem(proposalId,[false,false,false,true]);
       var tokens = await testSetup.standardTokenMock.balanceOf(otherAvatar.address);
       assert.equal(tokens.toNumber(),externalTokenReward);
      });

   //    it("execute proposeContributionReward proposal decision=='no' send externalToken  ", async function() {
   //      var testSetup = await setup(accounts);
   //      var reputationReward = 12;
   //      var nativeTokenReward = 12;
   //      var ethReward = 12;
   //      var externalTokenReward = 12;
   //      var periodLength = 50;
   //      var numberOfPeriods = 1;
   //      //send some ether to the org avatar
   //      var otherAvatar = await Avatar.new('otheravatar', helpers.NULL_ADDRESS, helpers.NULL_ADDRESS);
   //      await web3.eth.sendTransaction({from:accounts[0],to:testSetup.org.avatar.address, value:20});
   //      var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                     web3.utils.asciiToHex("description"),
   //                                                                     reputationReward,
   //                                                                     [nativeTokenReward,ethReward,externalTokenReward,periodLength,numberOfPeriods],
   //                                                                     testSetup.standardTokenMock.address,
   //                                                                     otherAvatar.address
   //                                                                   );
   //      //Vote with reputation to trigger execution
   //      var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //      var organizationProposal = await testSetup.contributionRewardExt.organizationProposals(proposalId);
   //      assert.equal(organizationProposal[5],otherAvatar.address);//beneficiary
   //      await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,0,0,helpers.NULL_ADDRESS,{from:accounts[2]});
   //      await helpers.increaseTime(periodLength+1);
   //      try {
   //        await testSetup.contributionRewardExt.redeem(proposalId,[true,true,true,true]);
   //        assert(false, 'redeem should revert because there was no positive voting');
   //      } catch (ex) {
   //        helpers.assertVMException(ex);
   //      }
   //     });
   //
   //
   // it("redeem periods ether ", async function() {
   //   var testSetup = await setup(accounts);
   //   var reputationReward = 0;
   //   var nativeTokenReward = 0;
   //   var ethReward = 3;
   //   var periodLength = 50;
   //   var numberOfPeriods = 5;
   //   //send some ether to the org avatar
   //   var otherAvatar = await Avatar.new('otheravatar', helpers.NULL_ADDRESS, helpers.NULL_ADDRESS);
   //   await web3.eth.sendTransaction({from:accounts[0],to:testSetup.org.avatar.address, value:12});
   //   var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                  web3.utils.asciiToHex("description"),
   //                                                                  reputationReward,
   //                                                                  [nativeTokenReward,ethReward,0,periodLength,numberOfPeriods],
   //                                                                  testSetup.standardTokenMock.address,
   //                                                                  otherAvatar.address
   //                                                                );
   //   //Vote with reputation to trigger execution
   //   var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //   await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[2]});
   //   await helpers.increaseTime(periodLength+1);
   //
   //   tx = await testSetup.contributionRewardExt.redeem(proposalId,[false,false,true,false]);
   //
   //   assert.equal(tx.logs.length, 1);
   //   assert.equal(tx.logs[0].event, "RedeemEther");
   //   assert.equal(tx.logs[0].args._amount, ethReward);
   //   var eth = await web3.eth.getBalance(otherAvatar.address);
   //   assert.equal(eth,ethReward);
   //
   //   //now try again on the same period
   //   tx = await testSetup.contributionRewardExt.redeem(proposalId,[false,false,true,false]);
   //   assert.equal(tx.logs.length, 0);
   //   eth = await web3.eth.getBalance(otherAvatar.address);
   //   assert.equal(eth,ethReward);
   //
   //   //now try again on 2nd period
   //   await helpers.increaseTime(periodLength+1);
   //
   //
   //   tx = await testSetup.contributionRewardExt.redeem(proposalId,[false,false,true,false]);
   //   assert.equal(tx.logs.length, 1);
   //   assert.equal(tx.logs[0].event, "RedeemEther");
   //   assert.equal(tx.logs[0].args._amount, ethReward);
   //   eth = await web3.eth.getBalance(otherAvatar.address);
   //   assert.equal(eth,ethReward*2);
   //
   //   //now try again on 4th period
   //   await helpers.increaseTime((periodLength*2)+1);
   //
   //
   //   tx = await testSetup.contributionRewardExt.redeem(proposalId,[false,false,true,false]);
   //   assert.equal(tx.logs.length, 1);
   //   assert.equal(tx.logs[0].event, "RedeemEther");
   //   assert.equal(tx.logs[0].args._amount, ethReward*2);
   //   eth = await web3.eth.getBalance(otherAvatar.address);
   //   assert.equal(eth,ethReward*4);
   //
   //   //now try again on 5th period - no ether on avatar should revert
   //   await helpers.increaseTime(periodLength+1);
   //   try {
   //        await testSetup.contributionRewardExt.redeem(proposalId,[false,false,true,false]);
   //        assert(false, 'redeem should revert because no ether left on avatar');
   //        } catch (ex) {
   //         helpers.assertVMException(ex);
   //   }
   //   await web3.eth.sendTransaction({from:accounts[0],to:testSetup.org.avatar.address, value:ethReward});
   //
   //
   //   tx = await testSetup.contributionRewardExt.redeem(proposalId,[false,false,true,false]);
   //   assert.equal(tx.logs.length, 1);
   //   assert.equal(tx.logs[0].event, "RedeemEther");
   //   assert.equal(tx.logs[0].args._amount, ethReward);
   //   eth = await web3.eth.getBalance(otherAvatar.address);
   //   assert.equal(eth,ethReward*5);
   //
   //
   //
   //   //cannot redeem any more..
   //   await helpers.increaseTime(periodLength+1);
   //   tx = await testSetup.contributionRewardExt.redeem(proposalId,[false,false,true,false]);
   //   assert.equal(tx.logs.length, 0);
   //   eth = await web3.eth.getBalance(otherAvatar.address);
   //   assert.equal(eth,ethReward*5);
   //
   //  });
   //
   //  it("execute proposeContributionReward  mint negative reputation ", async function() {
   //    var testSetup = await setup(accounts);
   //    var reputationReward = -12;
   //    var periodLength = 50;
   //    var numberOfPeriods = 1;
   //    var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                   web3.utils.asciiToHex("description"),
   //                                                                   reputationReward,
   //                                                                   [0,0,0,periodLength,numberOfPeriods],
   //                                                                   testSetup.standardTokenMock.address,
   //                                                                   accounts[0]
   //                                                                 );
   //    //Vote with reputation to trigger execution
   //    var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //    await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[2]});
   //    await helpers.increaseTime(periodLength+1);
   //    tx = await testSetup.contributionRewardExt.redeem(proposalId,[true,false,false,false]);
   //    assert.equal(tx.logs.length, 1);
   //    assert.equal(tx.logs[0].event, "RedeemReputation");
   //    assert.equal(tx.logs[0].args._amount, reputationReward);
   //    var rep = await testSetup.org.reputation.balanceOf(accounts[0]);
   //    assert.equal(rep.toNumber(),testSetup.reputationArray[0]+reputationReward);
   //   });
   //
   //
   //   it("call execute should revert ", async function() {
   //     var testSetup = await setup(accounts);
   //     var reputationReward = -12;
   //     var periodLength = 50;
   //     var numberOfPeriods = 1;
   //     var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                    web3.utils.asciiToHex("description"),
   //                                                                    reputationReward,
   //                                                                    [0,0,0,periodLength,numberOfPeriods],
   //                                                                    testSetup.standardTokenMock.address,
   //                                                                    accounts[0]
   //                                                                  );
   //     //Vote with reputation to trigger execution
   //     var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //     try {
   //          await testSetup.contributionRewardExt.executeProposal(proposalId,1);
   //          assert(false, 'only voting machine can call execute');
   //          } catch (ex) {
   //           helpers.assertVMException(ex);
   //     }
   //
   //    });
   //
   // it("execute proposeContributionReward via genesisProtocol and redeem using Redeemer", async function() {
   //   var standardTokenMock = await ERC20Mock.new(accounts[0],1000);
   //   var testSetup = await setup(accounts,true,standardTokenMock.address);
   //   var reputationReward = 12;
   //   var nativeTokenReward = 12;
   //   var ethReward = 12;
   //   var periodLength = 50;
   //   var numberOfPeriods = 1;
   //   //send some ether to the org avatar
   //   var otherAvatar = await Avatar.new('otheravatar', helpers.NULL_ADDRESS, helpers.NULL_ADDRESS);
   //   await web3.eth.sendTransaction({from:accounts[0],to:testSetup.org.avatar.address, value:20});
   //   var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                  web3.utils.asciiToHex("description"),
   //                                                                  reputationReward,
   //                                                                  [nativeTokenReward,ethReward,0,periodLength,numberOfPeriods],
   //                                                                  testSetup.standardTokenMock.address,
   //                                                                  otherAvatar.address
   //                                                                );
   //   //Vote with reputation to trigger execution
   //   var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //   await testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[0]});
   //   await helpers.increaseTime(periodLength+1);
   //   var arcUtils = await Redeemer.new();
   //   var redeemRewards = await arcUtils.redeem.call(testSetup.contributionRewardExt.address,
   //                                                  testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.address,
   //                                                  proposalId,testSetup.org.avatar.address,
   //                                                  accounts[0]);
   //   assert.equal(redeemRewards[0][1],100); //redeemRewards[0] gpRewards
   //   assert.equal(redeemRewards[0][2],60);
   //   assert.equal(redeemRewards[1][0],0); //daoBountyRewards
   //   assert.equal(redeemRewards[1][1],0); //daoBountyRewards
   //   assert.equal(redeemRewards[2],false); //isExecuted
   //   assert.equal(redeemRewards[3],1); //winningVote
   //   assert.equal(redeemRewards[4],reputationReward); //crReputationReward
   //   assert.equal(redeemRewards[5],nativeTokenReward); //crNativeTokenReward
   //   assert.equal(redeemRewards[6],ethReward); //crEthReward
   //   assert.equal(redeemRewards[7],0); //crExternalTokenReward
   //
   //   await arcUtils.redeem(testSetup.contributionRewardExt.address,
   //                         testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.address,
   //                         proposalId,testSetup.org.avatar.address,
   //                         accounts[0]);
   //
   //   var eth = await web3.eth.getBalance(otherAvatar.address);
   //   assert.equal(eth,ethReward);
   //   assert.equal(await testSetup.org.reputation.balanceOf(otherAvatar.address),reputationReward);
   //   assert.equal(await testSetup.org.token.balanceOf(otherAvatar.address),nativeTokenReward);
   //   var reputation = await testSetup.org.reputation.balanceOf(accounts[0]);
   //   var reputationGainAsVoter =  0;
   //   var proposingRepRewardConstA=60;
   //   var reputationGainAsProposer = proposingRepRewardConstA;
   //   assert.equal(reputation, 1000+reputationGainAsVoter + reputationGainAsProposer);
   //  });
   //
   //  it("execute proposeContributionReward via genesisProtocol and redeem using Redeemer for un excuted boosted proposal", async function() {
   //    var standardTokenMock = await ERC20Mock.new(accounts[0],1000);
   //    var testSetup = await setup(accounts,true,standardTokenMock.address);
   //    var reputationReward = 12;
   //    var nativeTokenReward = 12;
   //    var ethReward = 12;
   //    var periodLength = 0;
   //    var numberOfPeriods = 1;
   //    //send some ether to the org avatar
   //    var otherAvatar = await Avatar.new('otheravatar', helpers.NULL_ADDRESS, helpers.NULL_ADDRESS);
   //    await web3.eth.sendTransaction({from:accounts[0],to:testSetup.org.avatar.address, value:20});
   //    var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                   web3.utils.asciiToHex("description"),
   //                                                                   reputationReward,
   //                                                                   [nativeTokenReward,ethReward,0,periodLength,numberOfPeriods],
   //                                                                   testSetup.standardTokenMock.address,
   //                                                                   otherAvatar.address
   //                                                                 );
   //    //Vote with reputation to trigger execution
   //    var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //
   //    await testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[1]});
   //    await standardTokenMock.approve(testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.address,1000);
   //    await testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.stake(proposalId,1,1000);
   //    await helpers.increaseTime(60+1);
   //    var arcUtils = await Redeemer.new();
   //    var redeemRewards = await arcUtils.redeem.call(testSetup.contributionRewardExt.address,
   //                                                   testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.address,
   //                                                   proposalId,testSetup.org.avatar.address,
   //                                                   accounts[0]);
   //    assert.equal(redeemRewards[0][1],0); //redeemRewards[0] gpRewards
   //    assert.equal(redeemRewards[0][2],60);
   //    assert.equal(redeemRewards[1][0],0); //daoBountyRewards
   //    assert.equal(redeemRewards[1][1],15); //daoBountyRewards
   //    assert.equal(redeemRewards[2],true); //isExecuted
   //    assert.equal(redeemRewards[3],1); //winningVote
   //    assert.equal(redeemRewards[4],reputationReward); //crReputationReward
   //    assert.equal(redeemRewards[5],nativeTokenReward); //crNativeTokenReward
   //    assert.equal(redeemRewards[6],ethReward); //crEthReward
   //    assert.equal(redeemRewards[7],0); //crExternalTokenReward
   //
   //    await arcUtils.redeem(testSetup.contributionRewardExt.address,
   //                          testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.address,
   //                          proposalId,testSetup.org.avatar.address,
   //                          accounts[0]);
   //
   //    var eth = await web3.eth.getBalance(otherAvatar.address);
   //    assert.equal(eth,ethReward);
   //    assert.equal(await testSetup.org.reputation.balanceOf(otherAvatar.address),reputationReward);
   //    assert.equal(await testSetup.org.token.balanceOf(otherAvatar.address),nativeTokenReward);
   //    var reputation = await testSetup.org.reputation.balanceOf(accounts[0]);
   //    var reputationGainAsVoter =  0;
   //    var proposingRepRewardConstA=60;
   //    var reputationGainAsProposer = proposingRepRewardConstA;
   //    assert.equal(reputation, 1000+reputationGainAsVoter + reputationGainAsProposer);
   //   });
   //
   //  it("execute proposeContributionReward via genesisProtocol and redeem using Redeemer for negative proposal", async function() {
   //    var standardTokenMock = await ERC20Mock.new(accounts[0],1000);
   //    var testSetup = await setup(accounts,true,standardTokenMock.address);
   //    var reputationReward = 12;
   //    var nativeTokenReward = 12;
   //    var ethReward = 12;
   //    var periodLength = 50;
   //    var numberOfPeriods = 1;
   //    //send some ether to the org avatar
   //    var otherAvatar = await Avatar.new('otheravatar', helpers.NULL_ADDRESS, helpers.NULL_ADDRESS);
   //    await web3.eth.sendTransaction({from:accounts[0],to:testSetup.org.avatar.address, value:20});
   //    var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                   web3.utils.asciiToHex("description"),
   //                                                                   reputationReward,
   //                                                                   [nativeTokenReward,ethReward,0,periodLength,numberOfPeriods],
   //                                                                   testSetup.standardTokenMock.address,
   //                                                                   otherAvatar.address
   //                                                                 );
   //    //Vote with reputation to trigger execution
   //    var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //    await testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.vote(proposalId,2,0,helpers.NULL_ADDRESS,{from:accounts[0]});
   //    await helpers.increaseTime(periodLength+1);
   //    var arcUtils = await Redeemer.new();
   //    await arcUtils.redeem(testSetup.contributionRewardExt.address,
   //                          testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.address,
   //                          proposalId,
   //                          testSetup.org.avatar.address,
   //                          accounts[0]);
   //    var eth = await web3.eth.getBalance(otherAvatar.address);
   //    assert.equal(eth,0);
   //    assert.equal(await testSetup.org.reputation.balanceOf(otherAvatar.address),0);
   //    assert.equal(await testSetup.org.token.balanceOf(otherAvatar.address),0);
   //    var reputation = await testSetup.org.reputation.balanceOf(accounts[0]);
   //    //no reputation reward for proposer for negative proposal.
   //    //reputation reward for a single voter = 0
   //    assert.equal(reputation, 1000);
   //   });
   //
   //   it("execute proposeContributionReward via genesisProtocol and redeem using Redeemer ExpiredInQueue", async function() {
   //     var standardTokenMock = await ERC20Mock.new(accounts[0],1000);
   //     var testSetup = await setup(accounts,true,standardTokenMock.address);
   //     var reputationReward = 12;
   //     var nativeTokenReward = 12;
   //     var ethReward = 12;
   //     var periodLength = 50;
   //     var numberOfPeriods = 1;
   //     //send some ether to the org avatar
   //     var otherAvatar = await Avatar.new('otheravatar', helpers.NULL_ADDRESS, helpers.NULL_ADDRESS);
   //     var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                    web3.utils.asciiToHex("description"),
   //                                                                    reputationReward,
   //                                                                    [nativeTokenReward,ethReward,0,periodLength,numberOfPeriods],
   //                                                                    testSetup.standardTokenMock.address,
   //                                                                    otherAvatar.address
   //                                                                  );
   //     var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //
   //     await testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[1]});
   //     await helpers.increaseTime(60+1);
   //     var arcUtils = await Redeemer.new();
   //     await arcUtils.redeem(testSetup.contributionRewardExt.address,
   //                           testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.address,
   //                           proposalId,testSetup.org.avatar.address,
   //                           accounts[1]);
   //     var proposal = await testSetup.contributionRewardExtParams.votingMachine.genesisProtocol.proposals(proposalId);
   //     assert.equal(proposal.state,1); //ExpiredInQueue
   //     var reputation = await testSetup.org.reputation.balanceOf(accounts[1]);
   //     //accounts[1] redeems its deposit rep.
   //     assert.equal(reputation.toNumber(), 100);
   //    });
   //
   //  it("execute proposeContributionReward  mint reputation with period 0 ", async function() {
   //     var testSetup = await setup(accounts);
   //     var reputationReward = 12;
   //     var periodLength = 0;
   //     var numberOfPeriods = 1;
   //     var tx = await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                               web3.utils.asciiToHex("description"),
   //                                                               reputationReward,
   //                                                               [0,0,0,periodLength,numberOfPeriods],
   //                                                               testSetup.standardTokenMock.address,
   //                                                               accounts[1],
   //                                                               {from:accounts[2]}
   //                                                             );
   //     try {
   //          await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                 web3.utils.asciiToHex("description"),
   //                                                                 reputationReward,
   //                                                                 [0,0,0,periodLength,2],
   //                                                                 testSetup.standardTokenMock.address,
   //                                                                 accounts[1],
   //                                                                 {from:accounts[2]}
   //                                                               );
   //          assert(false, 'if periodLength==0  so numberOfPeriods must be 1');
   //          } catch (ex) {
   //           helpers.assertVMException(ex);
   //     }
   //
   //     //Vote with reputation to trigger execution
   //     var proposalId = await helpers.getValueFromLogs(tx, '_proposalId',1);
   //     await testSetup.contributionRewardExtParams.votingMachine.absoluteVote.vote(proposalId,1,0,helpers.NULL_ADDRESS,{from:accounts[2]});
   //     tx = await testSetup.contributionRewardExt.redeem(proposalId,[true,false,false,false]);
   //     assert.equal(tx.logs.length, 1);
   //     assert.equal(tx.logs[0].event, "RedeemReputation");
   //     assert.equal(tx.logs[0].args._amount, reputationReward);
   //     var rep = await testSetup.org.reputation.balanceOf(accounts[1]);
   //     assert.equal(rep.toNumber(),testSetup.reputationArray[1]+reputationReward);
   //     //try to redeem again.
   //     tx = await testSetup.contributionRewardExt.redeem(proposalId,[true,false,false,false]);
   //     assert.equal(tx.logs.length, 0);
   //     rep = await testSetup.org.reputation.balanceOf(accounts[1]);
   //     assert.equal(rep.toNumber(),testSetup.reputationArray[1]+reputationReward);
   //  });
   //
   //
   //  it("execute proposeContributionReward  param validate ", async function() {
   //     var testSetup = await setup(accounts);
   //     let BigNumber = require('bignumber.js');
   //     let reputationReward = ((new BigNumber(2)).toPower(255).sub(1)).toString(10);
   //     var periodLength = 1;
   //     var numberOfPeriods = 2;
   //
   //     try {
   //       await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                 web3.utils.asciiToHex("description"),
   //                                                                 reputationReward,
   //                                                                 [0,0,0,periodLength,numberOfPeriods],
   //                                                                 testSetup.standardTokenMock.address,
   //                                                                 accounts[1],
   //                                                                 {from:accounts[2]}
   //                                                               );
   //          assert(false, 'numberOfPeriods * _reputationChange should not overflow');
   //          } catch (ex) {
   //           helpers.assertVMException(ex);
   //     }
   //
   //     reputationReward = 12;
   //     var tokenReward = ((new BigNumber(2)).toPower(256).sub(1)).toString(10);
   //     var ethReward = 0;
   //     var externalTokenReward = 0;
   //
   //     try {
   //       await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                 web3.utils.asciiToHex("description"),
   //                                                                 reputationReward,
   //                                                                 [tokenReward,ethReward,externalTokenReward,periodLength,numberOfPeriods],
   //                                                                 testSetup.standardTokenMock.address,
   //                                                                 accounts[1],
   //                                                                 {from:accounts[2]}
   //                                                               );
   //          assert(false, 'numberOfPeriods * tokenReward should not overflow');
   //          } catch (ex) {
   //           helpers.assertVMException(ex);
   //     }
   //
   //      tokenReward = 0;
   //      ethReward = ((new BigNumber(2)).toPower(256).sub(1)).toString(10);
   //      externalTokenReward = 0;
   //
   //     try {
   //       await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                 web3.utils.asciiToHex("description"),
   //                                                                 reputationReward,
   //                                                                 [tokenReward,ethReward,externalTokenReward,periodLength,numberOfPeriods],
   //                                                                 testSetup.standardTokenMock.address,
   //                                                                 accounts[1],
   //                                                                 {from:accounts[2]}
   //                                                               );
   //          assert(false, 'numberOfPeriods * ethReward should not overflow');
   //          } catch (ex) {
   //           helpers.assertVMException(ex);
   //     }
   //
   //     tokenReward = 0;
   //     ethReward = 0;
   //     externalTokenReward = ((new BigNumber(2)).toPower(256).sub(1)).toString(10);
   //
   //    try {
   //      await testSetup.contributionRewardExt.proposeContributionReward(
   //                                                                web3.utils.asciiToHex("description"),
   //                                                                reputationReward,
   //                                                                [tokenReward,ethReward,externalTokenReward,periodLength,numberOfPeriods],
   //                                                                testSetup.standardTokenMock.address,
   //                                                                accounts[1],
   //                                                                {from:accounts[2]}
   //                                                              );
   //         assert(false, 'numberOfPeriods * externalTokenReward should not overflow');
   //         } catch (ex) {
   //          helpers.assertVMException(ex);
   //    }
   //  });
});