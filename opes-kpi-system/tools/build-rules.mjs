#!/usr/bin/env node
/**
 * Sinh file database.rules.json từ các "macro" quyền dưới đây.
 *
 * Vì Firebase Realtime Database Rules không hỗ trợ hàm/biến, các biểu thức lặp lại
 * (ai là quản lý trực tiếp, ai thuộc chuỗi quản lý, quyền theo ma trận...) được
 * ghép tự động tại đây để tránh lỗi gõ tay. File kết quả database.rules.json
 * vẫn được commit sẵn trong dự án – chỉ cần chạy lại script khi muốn đổi logic.
 *
 *   node tools/build-rules.mjs                # ghi đè ../database.rules.json
 *   BOOTSTRAP_ADMIN_EMAIL=you@x.vn node tools/build-rules.mjs
 *
 * Đây là công cụ phát triển chạy trên máy người quản trị, KHÔNG phải backend.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BOOTSTRAP_EMAIL = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@opes-kpi.demo').toLowerCase();

// ---------------------------------------------------------------------------
// Macro cơ bản. Mọi biểu thức đều được viết để KHÔNG phát sinh lỗi đánh giá
// (child(null), so sánh null > số...) – lỗi trong Rules đồng nghĩa từ chối.
// ---------------------------------------------------------------------------
const ME = "root.child('authLinks').child(auth.uid).child('userId').val()";
const LINKED = "(auth != null && root.child('authLinks').child(auth.uid).child('userId').isString())";
const ACCESS = `root.child('userAccess').child(${ME})`;
const permRaw = (a) => `${ACCESS}.child('perms').child('${a}').val() === true`;
const roleRaw = (r) => `${ACCESS}.child('roles').child('${r}').val() === true`;
/** Có quyền hành động a theo ma trận quyền (đã tính sẵn vào userAccess/{id}/perms). */
const P = (a) => `(${LINKED} && ${permRaw(a)})`;
const SYSADMIN = `(${LINKED} && ${roleRaw('sysAdmin')})`;

/** Trạng thái khởi tạo dữ liệu: DB chưa khởi tạo + email bootstrap, hoặc cửa sổ bảo trì do System Admin mở. */
const MAINT_UNTIL = "root.child('system').child('maintenance').child('until')";
const SEEDING =
  `(auth != null && ((!root.child('system').child('initializedAt').exists() && auth.token.email === '${BOOTSTRAP_EMAIL}')` +
  ` || (${MAINT_UNTIL}.isNumber() && ${MAINT_UNTIL}.val() > now && ${SYSADMIN})))`;

const or = (...xs) => `(${xs.filter(Boolean).join(' || ')})`;
const and = (...xs) => `(${xs.filter(Boolean).join(' && ')})`;
const inList = (expr, list) => or(...list.map((v) => `${expr} === '${v}'`));

// Dấu thời gian + người thực hiện được xác thực bởi Rules (không cho client tự khai).
const STAMP = (byField = 'by', atField = 'at') =>
  or(SEEDING, and(LINKED, `newData.child('${byField}').val() === ${ME}`, `newData.child('${atField}').val() === now`));
const REASON_OK = (node) =>
  and(`${node}.child('reason').isString()`, `${node}.child('reason').val().length > 0`);

// --- Kỳ đánh giá & người tham gia ----------------------------------------
const PERIOD = (p) => `root.child('evaluationPeriods').child(${p})`;
const PERIOD_STATUS = (p) => `${PERIOD(p)}.child('status').val()`;
const PERIOD_OPEN = (p) => `${PERIOD_STATUS(p)} === 'open'`;
const PERIOD_EVAL = (p) => or(`${PERIOD_STATUS(p)} === 'open'`, `${PERIOD_STATUS(p)} === 'consolidating'`);
const WF = (p, flow, key) => `${PERIOD(p)}.child('policies').child('workflow').child('${flow}').child('${key}').val()`;

const PU = (p, u) => `root.child('evaluationPeriodUsers').child(${p}).child(${u})`;
const SELF = (u) => `${u} === ${ME}`;
/** Người xem thuộc chuỗi quản lý phía trên (mọi cấp) – chuỗi do HR chụp khi khởi tạo kỳ. */
const IN_CHAIN = (p, u) => `${PU(p, u)}.child('chain').child(${ME}).exists()`;
const delegated = (p, managerExpr) =>
  `root.child('delegations').child(${p}).child(${managerExpr}).child(${ME}).child('active').val() === true`;
/** Quản lý trực tiếp theo kỳ (hoặc người được ủy quyền). Nếu nhân sự không có quản lý trực tiếp
 *  trong phạm vi (ví dụ PTGĐ thường trực) thì người có quyền approveTopLevel thực hiện bước này. */
const DIRECT_MGR = (p, u) => {
  const m = `${PU(p, u)}.child('managerId')`;
  return `(${m}.isString() ? (${m}.val() === ${ME} || ${delegated(p, `${m}.val()`)}) : ${permRaw('approveTopLevel')})`;
};
const SKIP_MGR = (p, u) => {
  const s = `${PU(p, u)}.child('skipManagerId')`;
  return `(${s}.isString() && (${s}.val() === ${ME} || ${delegated(p, `${s}.val()`)}))`;
};

// --- Kế hoạch KPI ----------------------------------------------------------
const PLAN = (p, u) => `root.child('kpiPlans').child(${p}).child(${u})`;
const PLAN_STATUS = `${PLAN('$p', '$u')}.child('status').val()`;
const PLAN_EDITABLE = and(
  PERIOD_OPEN('$p'),
  or(`!${PLAN('$p', '$u')}.child('status').exists()`, `${PLAN_STATUS} === 'draft'`, `${PLAN_STATUS} === 'returned'`),
);
const REQ_SKIP_PLAN = and(`${WF('$p', 'kpiPlan', 'requireSkipApproval')} !== false`, `${PU('$p', '$u')}.child('skipManagerId').isString()`);
const ALLOW_REVISION = `${WF('$p', 'kpiPlan', 'allowRevisionAfterApproval')} === true`;
const CAN_ASSIGN = and(IN_CHAIN('$p', '$u'), permRaw('assignKpi'));

// --- Hồ sơ đánh giá --------------------------------------------------------
const EVAL = (p, u) => `root.child('evaluations').child(${p}).child(${u})`;
const EVAL_STATUS = `${EVAL('$p', '$u')}.child('status').val()`;
const PLAN_APPROVED = `${PLAN('$p', '$u')}.child('status').val() === 'approved'`;
const SELF_EDITABLE = and(
  PERIOD_OPEN('$p'),
  PLAN_APPROVED,
  or(`!${EVAL('$p', '$u')}.child('status').exists()`, `${EVAL_STATUS} === 'draft'`, `${EVAL_STATUS} === 'returned'`),
);
const MGR_EDITABLE = and(DIRECT_MGR('$p', '$u'), permRaw('evaluateStaff'), PERIOD_EVAL('$p'), `${EVAL_STATUS} === 'submitted'`);
const SKIP_EDITABLE = and(SKIP_MGR('$p', '$u'), permRaw('approve'), PERIOD_EVAL('$p'), `${EVAL_STATUS} === 'manager_reviewed'`);
const REQ_SKIP_EVAL = and(`${WF('$p', 'evaluation', 'requireSkipApproval')} !== false`, `${PU('$p', '$u')}.child('skipManagerId').isString()`);
const AUTO_LOCK = `${WF('$p', 'evaluation', 'autoLockOnApproval')} === true`;

// Các kiểm tra trong cùng một lệnh cập nhật nhiều đường dẫn (newData.parent() = hồ sơ sau khi ghi)
const NP = "newData.parent()";
const VERSION_OK = `${NP}.child('version').isNumber()`;
const SIG_OK = (who) =>
  and(VERSION_OK, `${NP}.child('signatures').child('${who}').child('version').val() === ${NP}.child('version').val()`,
    `${NP}.child('signatures').child('${who}').child('userId').val() === ${ME}`);
const RETURN_OK = and(`${NP}.child('lastReturn').child('at').val() === now`,
  `${NP}.child('lastReturn').child('by').val() === ${ME}`, REASON_OK(`${NP}.child('lastReturn')`));
const UNLOCK_OK = and(`${NP}.child('lastUnlock').child('at').val() === now`,
  `${NP}.child('lastUnlock').child('by').val() === ${ME}`, REASON_OK(`${NP}.child('lastUnlock')`));
const FINAL_OK = and(`${NP}.child('final').child('computedAt').val() === now`,
  `${NP}.child('final').child('version').val() === ${NP}.child('version').val()`);
const EVAL_NOT_STARTED = or(`!${EVAL('$p', '$u')}.child('status').exists()`, `${EVAL('$p', '$u')}.child('status').val() === 'draft'`);

const VERSION_VALIDATE = or(SEEDING, and('newData.isNumber()',
  "(data.exists() ? (data.isNumber() && newData.val() === data.val() + 1) : newData.val() === 1)"));

const PLAN_STATUSES = ['draft', 'submitted', 'manager_approved', 'approved', 'returned'];
const EVAL_STATUSES = ['draft', 'submitted', 'manager_reviewed', 'approved', 'locked', 'returned'];
const PERIOD_STATUSES = ['draft', 'configured', 'open', 'paused', 'consolidating', 'locked', 'archived'];

const signatureNode = (writeExpr) => ({
  '.write': writeExpr,
  '.validate': or(SEEDING, and(LINKED, `newData.child('userId').val() === ${ME}`, `newData.child('at').val() === now`,
    "newData.child('version').isNumber()")),
});
const appendOnly = (writeExpr, extraValidate) => ({
  '.write': and(writeExpr, '!data.exists()', 'newData.exists()'),
  '.validate': extraValidate ? and(STAMP(), extraValidate) : STAMP(),
});

// ---------------------------------------------------------------------------
const rules = {
  rules: {
    '.read': SEEDING,
    '.write': SEEDING,

    system: {
      '.read': 'auth != null',
      maintenance: {
        '.write': SYSADMIN,
        '.validate': and("newData.hasChildren(['until', 'by', 'reason'])", "newData.child('until').isNumber()",
          "newData.child('until').val() <= now + 3600000", STAMP()),
      },
      schemaVersion: { '.write': SYSADMIN },
      seedInfo: { '.write': SYSADMIN },
    },

    public: {
      demoEnabled: { '.read': true, '.write': P('manageUsers') },
      branding: { '.read': true, '.write': P('manageConfig') },
      demoLoginOptions: {
        '.read': or("root.child('public').child('demoEnabled').val() === true", P('manageUsers')),
        $userId: {
          '.write': P('manageUsers'),
          authUid: {
            '.write': and('auth != null', 'newData.val() === auth.uid', 'data.parent().exists()', 'auth.token.email != null',
              "root.child('userProfiles').child($userId).child('email').val() === auth.token.email.toLowerCase()"),
          },
        },
      },
    },

    emailIndex: {
      '.read': P('manageUsers'),
      $emailKey: {
        '.read': and('auth != null', 'auth.token.email != null', "auth.token.email.toLowerCase().replace('.', ',') === $emailKey"),
        '.write': P('manageUsers'),
        '.validate': 'newData.isString()',
      },
    },

    authLinks: {
      '.read': P('manageUsers'),
      $authUid: {
        '.read': "auth != null && auth.uid === $authUid",
        '.write': or(
          and('auth != null', 'auth.uid === $authUid', '!data.exists()', "newData.child('userId').isString()", 'auth.token.email != null',
            "root.child('userProfiles').child(newData.child('userId').val()).child('email').val() === auth.token.email.toLowerCase()",
            "root.child('userProfiles').child(newData.child('userId').val()).child('status').val() === 'active'",
            or("!root.child('userProfiles').child(newData.child('userId').val()).child('authUid').exists()",
              "root.child('userProfiles').child(newData.child('userId').val()).child('authUid').val() === auth.uid")),
          SYSADMIN),
        '.validate': "newData.hasChildren(['userId', 'email'])",
      },
    },

    userProfiles: {
      '.read': LINKED,
      $userId: {
        '.write': P('manageUsers'),
        '.validate': "newData.hasChildren(['name', 'email', 'status'])",
        email: { '.validate': 'newData.isString() && newData.val() === newData.val().toLowerCase()' },
        status: { '.validate': inList('newData.val()', ['active', 'inactive']) },
        authUid: {
          '.write': and('auth != null', '!data.exists()', 'newData.val() === auth.uid', 'auth.token.email != null',
            "data.parent().child('email').val() === auth.token.email.toLowerCase()"),
        },
      },
    },

    userAccess: {
      '.read': or(P('manageUsers'), P('viewAudit')),
      $userId: {
        '.read': and(LINKED, `${ME} === $userId`),
        '.write': SYSADMIN,
      },
    },

    userPrefs: {
      $userId: { '.read': and(LINKED, `${ME} === $userId`), '.write': and(LINKED, `${ME} === $userId`) },
    },

    config: {
      '.read': LINKED,
      appSettings: { '.write': P('manageConfig') },
      kpiGroups: { '.write': P('manageCatalog') },
      scoringPolicies: { '.write': P('manageConfig') },
      kbiPolicies: { '.write': P('manageConfig') },
      gradingBands: { '.write': P('manageConfig') },
      weightPolicies: { '.write': P('manageConfig') },
      workflowTemplates: { '.write': P('manageConfig') },
      formTemplates: { '.write': P('manageConfig') },
      permissionPolicies: { '.write': SYSADMIN },
      $other: { '.write': P('manageConfig') },
    },

    organizationUnits: {
      '.read': LINKED,
      $unitId: {
        '.write': P('manageOrg'),
        '.validate': and("newData.hasChildren(['code', 'name', 'status', 'type'])",
          inList("newData.child('status').val()", ['active', 'inactive', 'archived'])),
        parentId: {
          '.validate': and('newData.isString()', 'newData.val() !== $unitId',
            "newData.parent().parent().child(newData.val()).exists()"),
        },
      },
    },

    organizationVersions: {
      '.read': LINKED,
      $versionId: { '.write': or(SEEDING, and(or(P('manageOrg'), P('managePeriods')), '!data.exists()')) },
    },

    kpiCatalogPublic: {
      '.read': LINKED,
      $kpiId: {
        '.write': P('manageCatalog'),
        '.validate': and("newData.hasChildren(['code', 'name', 'groupId', 'status'])",
          "newData.child('visibility').val() === 'public'"),
      },
    },

    kpiCatalogPrivate: {
      '.read': P('manageCatalog'),
      $kpiId: {
        '.read': and(LINKED, or(`data.child('ownerId').val() === ${ME}`,
          `root.child('kpiCatalogAccessIndex').child(${ME}).child($kpiId).exists()`)),
        '.write': or(P('manageCatalog'),
          and(P('createPrivateKpi'), 'newData.exists()',
            `(data.exists() ? data.child('ownerId').val() === ${ME} : newData.child('ownerId').val() === ${ME})`)),
        '.validate': and("newData.hasChildren(['code', 'name', 'ownerId', 'status'])",
          "newData.child('visibility').val() === 'private'"),
        ownerId: { '.validate': or('!data.exists()', 'newData.val() === data.val()', P('manageCatalog')) },
      },
    },

    kpiCatalogAccessIndex: {
      '.read': P('manageCatalog'),
      $userId: {
        '.read': and(LINKED, `${ME} === $userId`),
        $kpiId: {
          '.write': or(P('manageCatalog'),
            and(LINKED, or(`root.child('kpiCatalogPrivate').child($kpiId).child('ownerId').val() === ${ME}`,
              `newData.parent().parent().parent().child('kpiCatalogPrivate').child($kpiId).child('ownerId').val() === ${ME}`))),
          '.validate': 'newData.val() === true',
        },
      },
    },

    catalogHistory: {
      '.read': or(P('manageCatalog'), P('manageKbi'), P('viewAudit')),
      $catalogId: {
        '.read': and(LINKED, `root.child('kpiCatalogPrivate').child($catalogId).child('ownerId').val() === ${ME}`),
        $h: appendOnly(or(P('manageCatalog'), P('manageKbi'), P('createPrivateKpi'))),
      },
    },

    kbiCatalog: {
      '.read': LINKED,
      $kbiId: {
        '.write': P('manageKbi'),
        '.validate': and("newData.hasChildren(['code', 'name', 'levels', 'status'])",
          inList("newData.child('status').val()", ['active', 'inactive', 'archived'])),
      },
    },

    evaluationPeriods: {
      '.read': LINKED,
      $p: {
        '.write': P('managePeriods'),
        '.validate': "newData.hasChildren(['code', 'name', 'year', 'status'])",
        status: {
          '.validate': and('newData.isString()', inList('newData.val()', PERIOD_STATUSES),
            // Mở lại một kỳ đã khóa phải kèm lý do + người thực hiện được xác thực (lastUnlock)
            or(SEEDING, "data.val() !== 'locked'", "newData.val() === 'locked'", "newData.val() === 'archived'", UNLOCK_OK)),
        },
      },
    },

    evaluationPeriodUsers: {
      '.read': LINKED,
      $p: {
        '.write': P('managePeriods'),
        $u: {
          '.validate': "newData.hasChildren(['name', 'unitId'])",
          chain: { $ancestor: { '.validate': 'newData.isNumber()' } },
        },
      },
    },

    delegations: {
      $p: {
        '.read': LINKED,
        $from: {
          $to: {
            '.write': and(LINKED, or(permRaw('managePeriods'), `${ME} === $from`), '$to !== $from'),
            '.validate': "newData.hasChildren(['active', 'createdAt']) && newData.child('active').isBoolean()",
          },
        },
      },
    },

    // -----------------------------------------------------------------------
    kpiPlans: {
      $p: {
        '.read': P('viewAllPlans'),
        $u: {
          '.read': and(LINKED, or(SELF('$u'), IN_CHAIN('$p', '$u'), DIRECT_MGR('$p', '$u'), SKIP_MGR('$p', '$u'), permRaw('viewAllPlans'))),
          status: {
            '.write': and(LINKED, PERIOD_OPEN('$p'), `${PU('$p', '$u')}.exists()`, or(
              and(SELF('$u'), or(
                "(!data.exists() && newData.val() === 'draft')",
                and("(data.val() === 'draft' || data.val() === 'returned')", "newData.val() === 'submitted'", SIG_OK('employee')))),
              and(CAN_ASSIGN, '!data.exists()', "newData.val() === 'draft'"),
              and(DIRECT_MGR('$p', '$u'), "data.val() === 'submitted'", or(
                and("newData.val() === 'returned'", RETURN_OK),
                and("newData.val() === 'manager_approved'", REQ_SKIP_PLAN, SIG_OK('manager')),
                and("newData.val() === 'approved'", `!${REQ_SKIP_PLAN}`, SIG_OK('manager')))),
              and(SKIP_MGR('$p', '$u'), "data.val() === 'manager_approved'", or(
                and("newData.val() === 'approved'", SIG_OK('skip')),
                and("(newData.val() === 'returned' || newData.val() === 'submitted')", RETURN_OK))),
              // Mở sửa đổi kế hoạch đã duyệt (theo cấu hình kỳ), chỉ khi chưa bắt đầu đánh giá
              and(or(DIRECT_MGR('$p', '$u'), permRaw('unlockRecords')), "data.val() === 'approved'", "newData.val() === 'returned'",
                ALLOW_REVISION, UNLOCK_OK, EVAL_NOT_STARTED),
            )),
            '.validate': and('newData.isString()', inList('newData.val()', PLAN_STATUSES)),
          },
          statusMeta: {
            '.write': and(LINKED, or(SELF('$u'), IN_CHAIN('$p', '$u'), DIRECT_MGR('$p', '$u'), SKIP_MGR('$p', '$u'), permRaw('unlockRecords'))),
            '.validate': STAMP(),
          },
          version: { '.write': and(LINKED, SELF('$u'), PLAN_EDITABLE), '.validate': VERSION_VALIDATE },
          meta: { '.write': and(LINKED, or(SELF('$u'), CAN_ASSIGN), PLAN_EDITABLE) },
          lastReturn: {
            '.write': and(LINKED, or(DIRECT_MGR('$p', '$u'), SKIP_MGR('$p', '$u'), permRaw('unlockRecords'))),
            '.validate': and(STAMP(), REASON_OK('newData')),
          },
          lastUnlock: {
            '.write': and(LINKED, or(DIRECT_MGR('$p', '$u'), permRaw('unlockRecords'))),
            '.validate': and(STAMP(), REASON_OK('newData')),
          },
          signatures: {
            employee: signatureNode(and(LINKED, SELF('$u'), PLAN_EDITABLE)),
            manager: signatureNode(and(LINKED, DIRECT_MGR('$p', '$u'), PERIOD_OPEN('$p'), `${PLAN_STATUS} === 'submitted'`)),
            skip: signatureNode(and(LINKED, SKIP_MGR('$p', '$u'), PERIOD_OPEN('$p'), `${PLAN_STATUS} === 'manager_approved'`)),
            $other: { '.validate': false },
          },
          items: {
            $itemId: {
              '.validate': "newData.hasChildren(['spec', 'weight'])",
              spec: {
                '.write': and(LINKED, PLAN_EDITABLE, `${PU('$p', '$u')}.exists()`, or(
                  CAN_ASSIGN,
                  and(SELF('$u'), "(data.exists() ? data.child('source').val() !== 'assigned' : true)",
                    "(!newData.exists() || newData.child('source').val() !== 'assigned')"))),
                '.validate': and(
                  "newData.hasChildren(['title', 'source', 'groupId', 'state'])",
                  inList("newData.child('source').val()", ['assigned', 'catalog', 'custom', 'sub']),
                  inList("newData.child('state').val()", ['active', 'revoked']),
                  or("newData.child('source').val() !== 'catalog'", 'data.exists()', SEEDING, and(
                    "newData.child('catalogRef').child('id').isString()",
                    or("root.child('kpiCatalogPublic').child(newData.child('catalogRef').child('id').val()).exists()",
                      `root.child('kpiCatalogAccessIndex').child(${ME}).child(newData.child('catalogRef').child('id').val()).exists()`,
                      `root.child('kpiCatalogPrivate').child(newData.child('catalogRef').child('id').val()).child('ownerId').val() === ${ME}`))),
                  or("newData.child('source').val() !== 'assigned'", 'data.exists()', SEEDING,
                    `newData.child('assignedBy').val() === ${ME}`),
                ),
              },
              weight: {
                '.write': and(LINKED, PLAN_EDITABLE, or(
                  CAN_ASSIGN,
                  and(SELF('$u'), "(newData.exists() || newData.parent().child('spec').child('source').val() !== 'assigned')"))),
                '.validate': and('newData.isNumber()', 'newData.val() >= 0', 'newData.val() <= 100', or(
                  SEEDING,
                  `!(${SELF('$u')})`,
                  "newData.parent().child('spec').child('source').val() !== 'assigned'",
                  '(data.isNumber() && newData.val() === data.val())',
                  and("newData.parent().child('spec').child('weightMode').val() === 'flex'",
                    "newData.parent().child('spec').child('minWeight').isNumber()",
                    "newData.val() >= newData.parent().child('spec').child('minWeight').val()",
                    "(!newData.parent().child('spec').child('maxWeight').isNumber() || newData.val() <= newData.parent().child('spec').child('maxWeight').val())"))),
              },
              ack: {
                '.write': and(LINKED, PLAN_EDITABLE, or(SELF('$u'), CAN_ASSIGN)),
                '.validate': and("newData.hasChildren(['status'])",
                  inList("newData.child('status').val()", ['pending', 'accepted', 'change_requested']),
                  or(SEEDING, and(`newData.child('by').val() === ${ME}`, "newData.child('at').val() === now",
                    or(SELF('$u'), "newData.child('status').val() === 'pending'")))),
              },
              meta: { '.write': and(LINKED, PLAN_EDITABLE, or(SELF('$u'), CAN_ASSIGN)) },
              $other: { '.validate': false },
            },
          },
          history: {
            $h: appendOnly(and(LINKED, or(SELF('$u'), IN_CHAIN('$p', '$u'), DIRECT_MGR('$p', '$u'), SKIP_MGR('$p', '$u'), permRaw('unlockRecords')))),
          },
          returns: {
            $r: appendOnly(and(LINKED, or(DIRECT_MGR('$p', '$u'), SKIP_MGR('$p', '$u'), permRaw('unlockRecords'))), REASON_OK('newData')),
          },
          $other: { '.validate': false },
        },
      },
    },

    kpiAssignments: {
      $p: {
        '.read': P('viewAllPlans'),
        $from: {
          '.read': and(LINKED, `${ME} === $from`),
          $a: {
            '.read': and(LINKED, "data.child('toId').isString()", or(`data.child('toId').val() === ${ME}`,
              `root.child('evaluationPeriodUsers').child($p).child(data.child('toId').val()).child('chain').child(${ME}).exists()`)),
            '.write': and(LINKED, `${ME} === $from`, permRaw('assignKpi'), PERIOD_OPEN('$p'),
              `(newData.exists() ? (newData.child('toId').isString() && root.child('evaluationPeriodUsers').child($p).child(newData.child('toId').val()).child('chain').child(${ME}).exists()) : data.child('status').val() === 'draft')`),
            '.validate': and("newData.hasChildren(['fromId', 'toId', 'status', 'spec'])", "newData.child('fromId').val() === $from",
              inList("newData.child('status').val()", ['draft', 'assigned', 'accepted', 'change_requested', 'revoked'])),
            status: {
              '.write': and(LINKED, `root.child('kpiAssignments').child($p).child($from).child($a).child('toId').val() === ${ME}`,
                "(newData.val() === 'accepted' || newData.val() === 'change_requested')",
                "(data.val() === 'assigned' || data.val() === 'accepted' || data.val() === 'change_requested')"),
            },
            response: {
              '.write': and(LINKED, `root.child('kpiAssignments').child($p).child($from).child($a).child('toId').val() === ${ME}`),
              '.validate': STAMP(),
            },
          },
        },
      },
    },

    // -----------------------------------------------------------------------
    evaluations: {
      $p: {
        '.read': P('viewAllEvaluations'),
        $u: {
          '.read': and(LINKED, or(SELF('$u'), IN_CHAIN('$p', '$u'), DIRECT_MGR('$p', '$u'), SKIP_MGR('$p', '$u'), permRaw('viewAllEvaluations'))),
          status: {
            '.write': and(LINKED, `${PU('$p', '$u')}.exists()`, or(
              and(SELF('$u'), SELF_EDITABLE, or(
                "(!data.exists() && newData.val() === 'draft')",
                and("(data.val() === 'draft' || data.val() === 'returned')", "newData.val() === 'submitted'", SIG_OK('employee')))),
              and(MGR_EDITABLE, or(
                and("newData.val() === 'returned'", RETURN_OK),
                and("newData.val() === 'manager_reviewed'", REQ_SKIP_EVAL, SIG_OK('manager')),
                and(or("newData.val() === 'approved'", and("newData.val() === 'locked'", AUTO_LOCK)), `!${REQ_SKIP_EVAL}`, SIG_OK('manager'), FINAL_OK))),
              and(SKIP_EDITABLE, or(
                and("(newData.val() === 'returned' || newData.val() === 'submitted')", RETURN_OK),
                and(or("newData.val() === 'approved'", and("newData.val() === 'locked'", AUTO_LOCK)), SIG_OK('skip'), FINAL_OK))),
              and(permRaw('lockRecords'), PERIOD_EVAL('$p'), "data.val() === 'approved'", "newData.val() === 'locked'"),
              and(permRaw('unlockRecords'), PERIOD_EVAL('$p'), "(data.val() === 'locked' || data.val() === 'approved')",
                "(newData.val() === 'returned' || newData.val() === 'submitted')", UNLOCK_OK),
            )),
            '.validate': and('newData.isString()', inList('newData.val()', EVAL_STATUSES)),
          },
          statusMeta: {
            '.write': and(LINKED, or(SELF('$u'), IN_CHAIN('$p', '$u'), DIRECT_MGR('$p', '$u'), SKIP_MGR('$p', '$u'),
              permRaw('lockRecords'), permRaw('unlockRecords'))),
            '.validate': STAMP(),
          },
          version: { '.write': and(LINKED, SELF('$u'), SELF_EDITABLE), '.validate': VERSION_VALIDATE },
          meta: { '.write': and(LINKED, or(SELF('$u'), IN_CHAIN('$p', '$u')), '!data.exists()') },
          self: { '.write': and(LINKED, SELF('$u'), SELF_EDITABLE) },
          manager: { '.write': and(LINKED, MGR_EDITABLE) },
          skip: { '.write': and(LINKED, SKIP_EDITABLE) },
          signatures: {
            employee: signatureNode(and(LINKED, SELF('$u'), SELF_EDITABLE)),
            manager: signatureNode(and(LINKED, MGR_EDITABLE)),
            skip: signatureNode(and(LINKED, SKIP_EDITABLE)),
            $other: { '.validate': false },
          },
          final: {
            '.write': and(LINKED, or(
              and(MGR_EDITABLE, `!${REQ_SKIP_EVAL}`),
              SKIP_EDITABLE,
              and(permRaw('lockRecords'), PERIOD_EVAL('$p'), `${EVAL_STATUS} === 'approved'`))),
            '.validate': or(SEEDING, and(`newData.child('computedBy').val() === ${ME}`, "newData.child('computedAt').val() === now",
              "newData.child('version').isNumber()")),
          },
          lastReturn: {
            '.write': and(LINKED, or(MGR_EDITABLE, SKIP_EDITABLE)),
            '.validate': and(STAMP(), REASON_OK('newData')),
          },
          lastUnlock: {
            '.write': and(LINKED, permRaw('unlockRecords')),
            '.validate': and(STAMP(), REASON_OK('newData')),
          },
          returns: {
            $r: appendOnly(and(LINKED, or(MGR_EDITABLE, SKIP_EDITABLE, permRaw('unlockRecords'))), REASON_OK('newData')),
          },
          history: {
            $h: appendOnly(and(LINKED, or(SELF('$u'), IN_CHAIN('$p', '$u'), DIRECT_MGR('$p', '$u'), SKIP_MGR('$p', '$u'),
              permRaw('lockRecords'), permRaw('unlockRecords')))),
          },
          $other: { '.validate': false },
        },
      },
    },

    notifications: {
      $userId: {
        '.read': and(LINKED, `${ME} === $userId`),
        '.indexOn': ['at'],
        $n: {
          '.write': and(LINKED, or(`${ME} === $userId`, and('!data.exists()', `newData.child('fromId').val() === ${ME}`))),
          '.validate': and("newData.hasChildren(['type', 'title', 'at'])",
            or(SEEDING, `${ME} === $userId`, "newData.child('at').val() === now")),
        },
      },
    },

    auditLogs: {
      '.read': P('viewAudit'),
      '.indexOn': ['at', 'type', 'periodId', 'actorId'],
      $logId: {
        '.write': and(LINKED, '!data.exists()', 'newData.exists()'),
        '.validate': and("newData.hasChildren(['type', 'actorId', 'at'])",
          or(SEEDING, and(`newData.child('actorId').val() === ${ME}`, "newData.child('at').val() === now"))),
      },
    },
  },
};

const out = JSON.stringify(rules, null, 2) + '\n';
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'database.rules.json');
writeFileSync(target, out);
console.log(`Đã ghi ${target} (${(out.length / 1024).toFixed(1)} KB), bootstrap email: ${BOOTSTRAP_EMAIL}`);
